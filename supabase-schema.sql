-- Smart Sign Invoice database schema.
--
-- Safe to re-run: every statement is idempotent, so the same file both creates a new database and
-- migrates an existing one. Run it in the Supabase SQL Editor BEFORE deploying a new app version.
--
-- Security model:
--   * The Next.js server talks to Supabase with SUPABASE_SERVICE_ROLE_KEY only (bypasses RLS).
--   * Every table has RLS enabled with NO policies, and anon/authenticated privileges are revoked,
--     so the public anon/publishable key can read or write nothing - not users, OTPs, invoices or share tokens.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users and login OTPs
-- ---------------------------------------------------------------------------
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
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

-- Migration: wrong-guess counter used to burn an OTP after 5 failed attempts.
alter table public.smart_sign_login_otps
  add column if not exists attempts integer not null default 0;

create index if not exists smart_sign_login_otps_user_created_at_idx
  on public.smart_sign_login_otps (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Invoices (one shared workspace for all signed-in users)
-- ---------------------------------------------------------------------------
create table if not exists public.smart_sign_invoices (
  id text primary key,
  client_id text not null,
  name text not null,
  saved_at timestamptz not null,
  created_by text not null default 'unknown',
  invoice jsonb not null,
  lock_client_id text,
  lock_username text,
  lock_touched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migrations for databases created by older versions.
alter table public.smart_sign_invoices add column if not exists created_by text not null default 'unknown';
alter table public.smart_sign_invoices add column if not exists lock_client_id text;
alter table public.smart_sign_invoices add column if not exists lock_username text;
alter table public.smart_sign_invoices add column if not exists lock_touched_at timestamptz;

-- The edit lock used to live inside the invoice JSON; it now has its own columns.
update public.smart_sign_invoices
set invoice = invoice - 'activeLock'
where invoice ? 'activeLock';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smart_sign_invoices_invoice_is_object') then
    alter table public.smart_sign_invoices
      add constraint smart_sign_invoices_invoice_is_object check (jsonb_typeof(invoice) = 'object');
  end if;
end $$;

-- The list endpoint filters and sorts by saved_at only.
create index if not exists smart_sign_invoices_saved_at_idx
  on public.smart_sign_invoices (saved_at desc);
drop index if exists public.smart_sign_invoices_client_saved_at_idx;

create or replace function public.set_smart_sign_updated_at()
returns trigger
language plpgsql
set search_path = ''
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
execute function public.set_smart_sign_updated_at();

drop function if exists public.set_smart_sign_invoices_updated_at();

-- ---------------------------------------------------------------------------
-- Public invoice sharing
-- ---------------------------------------------------------------------------
create table if not exists public.smart_sign_invoice_shares (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique,
  invoice_id text not null unique references public.smart_sign_invoices(id) on delete cascade,
  created_by text not null,
  is_enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_smart_sign_invoice_shares_updated_at on public.smart_sign_invoice_shares;
create trigger set_smart_sign_invoice_shares_updated_at
before update on public.smart_sign_invoice_shares
for each row
execute function public.set_smart_sign_updated_at();

drop function if exists public.set_smart_sign_invoice_shares_updated_at();

-- ---------------------------------------------------------------------------
-- Lock everything down for the anon/publishable key
-- ---------------------------------------------------------------------------
alter table public.smart_sign_users enable row level security;
alter table public.smart_sign_login_otps enable row level security;
alter table public.smart_sign_invoices enable row level security;
alter table public.smart_sign_invoice_shares enable row level security;

-- Older versions of this file granted the anon key full access (including password hashes). Remove that.
drop policy if exists smart_sign_users_select on public.smart_sign_users;
drop policy if exists smart_sign_users_insert on public.smart_sign_users;
drop policy if exists smart_sign_login_otps_select on public.smart_sign_login_otps;
drop policy if exists smart_sign_login_otps_insert on public.smart_sign_login_otps;
drop policy if exists smart_sign_login_otps_update on public.smart_sign_login_otps;
drop policy if exists smart_sign_invoices_select_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_insert_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_update_own_client on public.smart_sign_invoices;
drop policy if exists smart_sign_invoices_delete_own_client on public.smart_sign_invoices;

revoke all on public.smart_sign_users from anon, authenticated;
revoke all on public.smart_sign_login_otps from anon, authenticated;
revoke all on public.smart_sign_invoices from anon, authenticated;
revoke all on public.smart_sign_invoice_shares from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Optional housekeeping: remove OTP rows a day after they expire.
-- With the pg_cron extension enabled you can schedule it, e.g.:
--   select cron.schedule('smart-sign-otp-cleanup', '0 3 * * *',
--     $$delete from public.smart_sign_login_otps where expires_at < now() - interval '1 day'$$);
-- ---------------------------------------------------------------------------
