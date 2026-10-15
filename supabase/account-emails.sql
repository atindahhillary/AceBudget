-- ============================================================================
-- AceBudget: which account emails to send, and to whom.
--
-- Each row added to public.acebudget_emails is one email. A database webhook
-- on that table (Insert) calls the welcome-email Edge Function, which sends it:
--   kind 'welcome'  when someone creates an AceBudget account
--   kind 'sign_in'  every time an AceBudget user signs in
--
-- amora shares this project's accounts, so only AceBudget users are emailed:
-- accounts created by AceBudget's sign-up form (tagged app = 'acebudget') and
-- older accounts that have saved an AceBudget budget. The automatic sign-in
-- that comes with creating an account is skipped, so a new user gets the
-- welcome email only.
--
-- These triggers run inside Supabase's own sign-up and sign-in. They catch
-- every error, so a missed email can never stop anyone signing up or in.
--
-- Paste it into Supabase > SQL Editor and press Run. Safe to run more than once.
-- ============================================================================

create table if not exists public.acebudget_emails (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('welcome', 'sign_in')),
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- Written only by the triggers below; no app or API access at all.
alter table public.acebudget_emails enable row level security;
revoke all on public.acebudget_emails from anon, authenticated;

-- Is this account an AceBudget user?
create or replace function public.acebudget_is_user(u auth.users)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.raw_user_meta_data ->> 'app', '') = 'acebudget'
      or exists (select 1 from public.acebudget_states s where s.user_id = u.id);
$$;

revoke execute on function public.acebudget_is_user(auth.users) from public, anon, authenticated;

-- A new account: welcome email.
create or replace function public.acebudget_queue_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.acebudget_is_user(new) then
    insert into public.acebudget_emails (user_id, kind, email, full_name)
    values (new.id, 'welcome', new.email, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  end if;
  return new;
exception when others then
  raise warning 'acebudget_queue_welcome skipped: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.acebudget_queue_welcome() from public, anon, authenticated;

drop trigger if exists acebudget_on_auth_user_created_email on auth.users;
create trigger acebudget_on_auth_user_created_email
  after insert on auth.users
  for each row execute function public.acebudget_queue_welcome();

-- A sign-in: sign-in email.
create or replace function public.acebudget_queue_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is null then
    return new;
  end if;
  -- The sign-in that comes with creating an account: the welcome email covers it.
  if new.created_at > new.last_sign_in_at - interval '1 minute' then
    return new;
  end if;
  if public.acebudget_is_user(new) then
    insert into public.acebudget_emails (user_id, kind, email, full_name)
    values (
      new.id, 'sign_in', new.email,
      coalesce(
        (select p.full_name from public.acebudget_profiles p where p.id = new.id),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'acebudget_queue_sign_in skipped: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.acebudget_queue_sign_in() from public, anon, authenticated;

drop trigger if exists acebudget_on_auth_user_signed_in on auth.users;
create trigger acebudget_on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function public.acebudget_queue_sign_in();
