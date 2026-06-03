create table if not exists public.smart_sign_invoices (
  id text primary key,
  client_id text not null,
  name text not null,
  saved_at timestamptz not null,
  invoice jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists smart_sign_invoices_client_saved_at_idx
  on public.smart_sign_invoices (client_id, saved_at desc);

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
