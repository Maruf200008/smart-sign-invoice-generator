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
-- Server save sync (POST /api/v1/sync/save)
--
--   * version: optimistic-locking counter, bumped on every save. A client sends the version it last saw;
--     if the row has moved on, the save is rejected as a conflict instead of silently overwriting.
--   * smart_sign_sync_receipts: one row per accepted syncId (idempotency key), so a retried request whose
--     first attempt actually reached the database is answered from the receipt instead of saving twice.
-- ---------------------------------------------------------------------------
alter table public.smart_sign_invoices add column if not exists version integer not null default 1;

create table if not exists public.smart_sign_sync_receipts (
  sync_id text primary key,
  invoice_id text not null references public.smart_sign_invoices(id) on delete cascade,
  client_id text not null,
  version integer not null,
  server_updated_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists smart_sign_sync_receipts_invoice_created_idx
  on public.smart_sign_sync_receipts (invoice_id, created_at);

/*
 * Saves one invoice in a single transaction (a plpgsql function body always runs atomically).
 * Returns jsonb with "status" = saved | duplicate | conflict | locked.
 *
 * Concurrency: the existing row is locked FOR UPDATE before anything else, so two saves of the same invoice
 * are serialized. The receipt lookup happens after the row lock, so a duplicate request that raced the
 * original sees the original's receipt (READ COMMITTED re-reads per statement) and is answered as duplicate.
 */
drop function if exists public.smart_sign_save_invoice(text, text, text, text, text, jsonb, integer, integer);

create or replace function public.smart_sign_save_invoice(
  p_sync_id text,
  p_invoice_id text,
  p_client_id text,
  p_username text,
  p_name text,
  p_invoice jsonb,
  p_base_version integer,
  p_lock_window_ms integer default 30000,
  p_prior_sync_ids text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row record;
  v_receipt record;
  v_version integer;
  v_created_by text;
  v_exists boolean;
  v_base integer := coalesce(p_base_version, 0);
  v_own_versions integer;
begin
  select version, created_by, name, saved_at, invoice, lock_client_id, lock_username, lock_touched_at
  into v_row
  from public.smart_sign_invoices
  where id = p_invoice_id
  for update;
  v_exists := found;

  select version, server_updated_at, created_by, invoice_id into v_receipt
  from public.smart_sign_sync_receipts
  where sync_id = p_sync_id;

  if found then
    if v_receipt.invoice_id <> p_invoice_id then
      raise exception 'sync id reused for another invoice' using errcode = '22023';
    end if;

    return jsonb_build_object('status', 'duplicate', 'version', v_receipt.version,
      'server_updated_at', v_receipt.server_updated_at, 'created_by', v_receipt.created_by);
  end if;

  if not v_exists then
    if v_base > 0 then
      -- The client last saw a stored copy, but it is gone: deleted on another device.
      return jsonb_build_object('status', 'conflict', 'reason', 'deleted', 'version', null);
    end if;

    insert into public.smart_sign_invoices
      (id, client_id, name, saved_at, created_by, invoice, version, lock_client_id, lock_username, lock_touched_at)
    values
      (p_invoice_id, p_client_id, p_name, v_now, p_username, p_invoice, 1, p_client_id, p_username, v_now)
    on conflict (id) do nothing
    returning version, created_by into v_version, v_created_by;

    if v_version is null then
      -- Another request created it a moment ago. If that was this same sync (a racing duplicate), say so.
      select version, server_updated_at, created_by into v_receipt
      from public.smart_sign_sync_receipts where sync_id = p_sync_id;

      if found then
        return jsonb_build_object('status', 'duplicate', 'version', v_receipt.version,
          'server_updated_at', v_receipt.server_updated_at, 'created_by', v_receipt.created_by);
      end if;

      return jsonb_build_object('status', 'conflict', 'reason', 'exists', 'version',
        (select version from public.smart_sign_invoices where id = p_invoice_id));
    end if;
  else
    if v_row.lock_client_id is not null
       and v_row.lock_client_id <> p_client_id
       and v_row.lock_touched_at is not null
       and v_row.lock_touched_at > v_now - make_interval(secs => p_lock_window_ms / 1000.0) then
      return jsonb_build_object('status', 'locked', 'locked_by', v_row.lock_username);
    end if;

    if v_base <> v_row.version then
      -- A save whose response never reached the client still bumped the version. When every version
      -- after the client's base came from this client's own unconfirmed syncIds, it is not a conflict.
      select count(*) into v_own_versions
      from public.smart_sign_sync_receipts
      where invoice_id = p_invoice_id
        and sync_id = any(coalesce(p_prior_sync_ids, '{}'))
        and version > v_base;

      if (v_base > v_row.version or v_own_versions <> v_row.version - v_base)
         and v_row.invoice = p_invoice and v_row.name = p_name then
        -- Same content as the server already holds (e.g. a client that lost track of the version):
        -- nothing to overwrite, so not a conflict. Acknowledge without bumping the version.
        insert into public.smart_sign_sync_receipts (sync_id, invoice_id, client_id, version, server_updated_at, created_by)
        values (p_sync_id, p_invoice_id, p_client_id, v_row.version, v_row.saved_at, v_row.created_by)
        on conflict (sync_id) do nothing;

        return jsonb_build_object('status', 'saved', 'version', v_row.version,
          'server_updated_at', v_row.saved_at, 'created_by', v_row.created_by);
      end if;

      if v_base > v_row.version or v_own_versions <> v_row.version - v_base then
        return jsonb_build_object('status', 'conflict', 'reason', 'stale', 'version', v_row.version,
        'server', jsonb_build_object('id', p_invoice_id, 'name', v_row.name, 'savedAt', v_row.saved_at,
          'createdBy', v_row.created_by, 'invoice', v_row.invoice, 'version', v_row.version));
      end if;
    end if;

    update public.smart_sign_invoices
    set name = p_name,
        saved_at = v_now,
        invoice = p_invoice,
        client_id = p_client_id,
        version = v_row.version + 1,
        lock_client_id = p_client_id,
        lock_username = p_username,
        lock_touched_at = v_now
    where id = p_invoice_id
    returning version, created_by into v_version, v_created_by;
  end if;

  insert into public.smart_sign_sync_receipts (sync_id, invoice_id, client_id, version, server_updated_at, created_by)
  values (p_sync_id, p_invoice_id, p_client_id, v_version, v_now, v_created_by)
  on conflict (sync_id) do nothing;

  -- Receipts only need to outlive client retries; keep the table small.
  delete from public.smart_sign_sync_receipts
  where invoice_id = p_invoice_id and created_at < v_now - interval '7 days';

  return jsonb_build_object('status', 'saved', 'version', v_version, 'server_updated_at', v_now, 'created_by', v_created_by);
end;
$$;

-- Only the server (service_role) may call it.
revoke all on function public.smart_sign_save_invoice(text, text, text, text, text, jsonb, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.smart_sign_save_invoice(text, text, text, text, text, jsonb, integer, integer, text[]) to service_role;

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
alter table public.smart_sign_sync_receipts enable row level security;

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
revoke all on public.smart_sign_sync_receipts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Optional housekeeping: remove OTP rows a day after they expire.
-- With the pg_cron extension enabled you can schedule it, e.g.:
--   select cron.schedule('smart-sign-otp-cleanup', '0 3 * * *',
--     $$delete from public.smart_sign_login_otps where expires_at < now() - interval '1 day'$$);
-- ---------------------------------------------------------------------------
