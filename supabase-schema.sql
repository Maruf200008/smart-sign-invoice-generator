-- Recommended setup:
-- Use SUPABASE_SERVICE_ROLE_KEY in .env.local for this server API route.
-- The service role key bypasses RLS and should never be exposed in client-side code.
-- If you use only NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, run the RLS policies below.

create extension if not exists pgcrypto;

create table if not exists public.smart_sign_invoices (
  id text primary key,
  client_id text not null,
  name text not null,
  saved_at timestamptz not null,
  created_by text not null default 'unknown',
  invoice jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.smart_sign_invoices
add column if not exists created_by text not null default 'unknown';

create index if not exists smart_sign_invoices_client_saved_at_idx
  on public.smart_sign_invoices (client_id, saved_at desc);

create table if not exists public.smart_sign_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.smart_sign_login_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.smart_sign_users(id) on delete cascade,
  username text not null,
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists smart_sign_login_otps_user_created_at_idx
  on public.smart_sign_login_otps (user_id, created_at desc);

alter table public.smart_sign_users enable row level security;
alter table public.smart_sign_login_otps enable row level security;

drop policy if exists smart_sign_users_select on public.smart_sign_users;
drop policy if exists smart_sign_users_insert on public.smart_sign_users;
drop policy if exists smart_sign_login_otps_select on public.smart_sign_login_otps;
drop policy if exists smart_sign_login_otps_insert on public.smart_sign_login_otps;
drop policy if exists smart_sign_login_otps_update on public.smart_sign_login_otps;

create policy smart_sign_users_select
on public.smart_sign_users
for select
to anon, authenticated
using (true);

create policy smart_sign_users_insert
on public.smart_sign_users
for insert
to anon, authenticated
with check (email <> '' and username <> '' and password_hash <> '');

create policy smart_sign_login_otps_select
on public.smart_sign_login_otps
for select
to anon, authenticated
using (true);

create policy smart_sign_login_otps_insert
on public.smart_sign_login_otps
for insert
to anon, authenticated
with check (email <> '' and username <> '' and otp_hash <> '');

create policy smart_sign_login_otps_update
on public.smart_sign_login_otps
for update
to anon, authenticated
using (true)
with check (true);

create or replace function public.set_smart_sign_invoices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_smart_sign_invoices_updated_at on public.smart_sign_invoices;

create trigger set_smart_sign_invoices_updated_at
before update on public.smart_sign_invoices
for each row
execute function public.set_smart_sign_invoices_updated_at();

alter table public.smart_sign_invoices enable row level security;

drop policy if exists smart_sign_invoices_select_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_insert_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_update_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_delete_own_client on public.smart_sign_invoices;

create policy smart_sign_invoices_select_own_client
on public.smart_sign_invoices
for select
to anon, authenticated
using (true);

create policy smart_sign_invoices_insert_own_client
on public.smart_sign_invoices
for insert
to anon, authenticated
with check (client_id <> '');

create policy smart_sign_invoices_update_own_client
on public.smart_sign_invoices
for update
to anon, authenticated
using (true)
with check (client_id <> '');

create policy smart_sign_invoices_delete_own_client
on public.smart_sign_invoices
for delete
to anon, authenticated
using (true);
