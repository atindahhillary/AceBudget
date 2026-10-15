-- ============================================================================
-- AceBudget: keep each user's full name, phone and email on their profile.
--
-- The sign-up form sends `full_name` and an optional `phone` (international
-- form, e.g. +254712345678) with the new account. This copies them, and the
-- account's own email, into public.acebudget_profiles, and keeps the profile
-- email equal to the sign-in email if it ever changes.
--
-- It only adds columns, functions and triggers; it replaces nothing that was
-- already there. Paste it into Supabase > SQL Editor and press Run. Safe to
-- run more than once.
-- ============================================================================

alter table public.acebudget_profiles
  add column if not exists full_name text,
  add column if not exists phone     text;

-- Before a profile row is saved, fill it from the account it belongs to. The
-- email always comes from the account itself, so the two can never differ.
create or replace function public.acebudget_profile_fill_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u auth.users%rowtype;
begin
  select * into u from auth.users where id = new.id;
  if found then
    new.email     := u.email;
    new.full_name := coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), new.full_name);
    new.phone     := coalesce(nullif(trim(u.raw_user_meta_data ->> 'phone'), ''), new.phone);
  end if;
  return new;
end;
$$;

revoke execute on function public.acebudget_profile_fill_details() from public, anon, authenticated;

drop trigger if exists acebudget_profiles_fill_details on public.acebudget_profiles;
create trigger acebudget_profiles_fill_details
  before insert on public.acebudget_profiles
  for each row execute function public.acebudget_profile_fill_details();

-- If someone changes the email they sign in with, update their profile too.
create or replace function public.acebudget_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acebudget_profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function public.acebudget_sync_profile_email() from public, anon, authenticated;

drop trigger if exists acebudget_on_auth_user_email_changed on auth.users;
create trigger acebudget_on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.acebudget_sync_profile_email();

-- Bring existing profiles in line: same email as the account, and any name or
-- phone already saved with the account.
update public.acebudget_profiles p
   set email     = u.email,
       full_name = coalesce(p.full_name, nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')),
       phone     = coalesce(p.phone, nullif(trim(u.raw_user_meta_data ->> 'phone'), ''))
  from auth.users u
 where u.id = p.id;
