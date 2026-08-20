create schema if not exists entry_identity;
create extension if not exists pgcrypto;

do $$ begin
  create type entry_identity.entry_product as enum ('PERSONAL', 'MINISTRY', 'CONSULTING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_identity.entitlement_status as enum ('ACTIVE', 'PENDING', 'SUSPENDED', 'REVOKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_identity.identity_link_status as enum ('ACTIVE', 'REVOKED');
exception when duplicate_object then null; end $$;

create table if not exists entry_identity.identity_profiles (
  canonical_user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists entry_identity.product_entitlements (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references auth.users(id) on delete cascade,
  product entry_identity.entry_product not null,
  status entry_identity.entitlement_status not null default 'PENDING',
  granted_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid references auth.users(id),
  source text not null default 'administrative',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_user_id, product)
);

create table if not exists entry_identity.product_identity_links (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references auth.users(id) on delete cascade,
  product entry_identity.entry_product not null,
  product_local_subject_id text not null,
  status entry_identity.identity_link_status not null default 'ACTIVE',
  proof_type text,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (product, product_local_subject_id)
);

create table if not exists entry_identity.product_handoff_nonces (
  jti uuid primary key,
  canonical_user_id uuid not null references auth.users(id) on delete cascade,
  product entry_identity.entry_product not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists entry_identity.identity_audit_events (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  product entry_identity.entry_product,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

revoke all on schema entry_identity from anon, authenticated;
revoke all on entry_identity.identity_profiles, entry_identity.product_entitlements, entry_identity.product_identity_links, entry_identity.product_handoff_nonces, entry_identity.identity_audit_events from anon, authenticated;
grant usage on schema entry_identity to authenticated;
grant select on entry_identity.identity_profiles, entry_identity.product_entitlements, entry_identity.product_identity_links to authenticated;
grant update (display_name, preferred_name, updated_at) on entry_identity.identity_profiles to authenticated;

alter table entry_identity.identity_profiles enable row level security;
alter table entry_identity.product_entitlements enable row level security;
alter table entry_identity.product_identity_links enable row level security;
alter table entry_identity.product_handoff_nonces enable row level security;
alter table entry_identity.identity_audit_events enable row level security;

create policy "users read own profile" on entry_identity.identity_profiles for select to authenticated using (canonical_user_id = (select auth.uid()));
create policy "users update own profile" on entry_identity.identity_profiles for update to authenticated using (canonical_user_id = (select auth.uid())) with check (canonical_user_id = (select auth.uid()));
create policy "users read own entitlement summary" on entry_identity.product_entitlements for select to authenticated using (canonical_user_id = (select auth.uid()));
create policy "users read own links" on entry_identity.product_identity_links for select to authenticated using (canonical_user_id = (select auth.uid()));

create or replace function entry_identity.redeem_handoff_nonce(
  p_jti uuid,
  p_product entry_identity.entry_product,
  p_canonical_user_id uuid
)
returns boolean
language sql
security definer
set search_path = entry_identity, pg_catalog
as $$
  update entry_identity.product_handoff_nonces
     set redeemed_at = now()
   where jti = p_jti
     and product = p_product
     and canonical_user_id = p_canonical_user_id
     and redeemed_at is null
     and expires_at > now()
  returning true;
$$;

revoke all on function entry_identity.redeem_handoff_nonce(uuid, entry_identity.entry_product, uuid) from public, anon, authenticated;

-- No trigger is installed on auth.users. Temporary verification must not
-- modify Meridian's existing Auth triggers or functions. Synthetic profiles
-- are created explicitly by the test harness.
