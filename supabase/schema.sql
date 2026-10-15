-- ============================================================================
-- AceBudget: database setup.
--
-- These tables already exist in the shared amora project. This file records
-- them so they can be recreated in a fresh project if AceBudget ever moves:
-- paste it into Supabase > SQL Editor and press Run. It is safe to run more
-- than once. Then run profile-details.sql, which adds each user's full name
-- and phone. See docs/SUPABASE-SETUP.md for the rest of the setup.
-- ============================================================================

-- --- tables ------------------------------------------------------------------

-- One row per user. `plan` is where a future paywall would hang; nothing reads
-- it yet.
create table if not exists public.acebudget_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  household  text,
  plan       text not null default 'free' check (plan in ('free', 'full')),
  created_at timestamptz not null default now()
);

-- One row per user per app: the full app and the free sample are kept apart.
-- The primary key is what the app's upsert (Prefer: merge-duplicates) uses.
create table if not exists public.acebudget_states (
  user_id    uuid not null references auth.users (id) on delete cascade,
  app        text not null check (app in ('full', 'free')),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);

-- --- row level security: a user only ever sees their own rows -----------------

alter table public.acebudget_profiles enable row level security;
alter table public.acebudget_states   enable row level security;

drop policy if exists "own profile: read" on public.acebudget_profiles;
create policy "own profile: read" on public.acebudget_profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "own state: read"   on public.acebudget_states;
drop policy if exists "own state: insert" on public.acebudget_states;
drop policy if exists "own state: update" on public.acebudget_states;
drop policy if exists "own state: delete" on public.acebudget_states;
create policy "own state: read"   on public.acebudget_states
  for select to authenticated using (auth.uid() = user_id);
create policy "own state: insert" on public.acebudget_states
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own state: update" on public.acebudget_states
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own state: delete" on public.acebudget_states
  for delete to authenticated using (auth.uid() = user_id);

-- --- a profile row for every new account ----------------------------------------
-- The welcome email is sent by a database webhook on inserts into this table
-- (see supabase/functions/welcome-email).

create or replace function public.acebudget_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.acebudget_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the trigger may run it; never callable over the REST API.
revoke execute on function public.acebudget_handle_new_user() from public, anon, authenticated;

drop trigger if exists acebudget_on_auth_user_created on auth.users;
create trigger acebudget_on_auth_user_created
  after insert on auth.users
  for each row execute function public.acebudget_handle_new_user();
