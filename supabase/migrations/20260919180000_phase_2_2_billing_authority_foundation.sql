-- Phase 2.2 Slice A: private Entry billing authority and idempotency foundation.
-- No billing enforcement is enabled by this migration.

do $$ begin
  create type entry_identity.entitlement_authority_kind as enum (
    'BILLING',
    'OFFER_ELIGIBILITY',
    'INTERNAL_OPERATOR',
    'LEGACY_PREBILLING'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_identity.personal_commercial_offer as enum (
    'STANDARD_INDIVIDUAL',
    'SOTF_FOUNDING_FELLOW'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_identity.personal_billing_state as enum (
    'PENDING_CHECKOUT',
    'TRIALING',
    'ACTIVE',
    'PAYMENT_GRACE',
    'PAUSED_NO_PAYMENT_METHOD',
    'SUSPENDED_PAYMENT',
    'CANCEL_AT_PERIOD_END',
    'CANCELED',
    'INTERNAL_OPERATOR'
  );
exception when duplicate_object then null; end $$;

alter table entry_identity.product_entitlements
  add column if not exists authority_kind entry_identity.entitlement_authority_kind;

alter table entry_identity.product_entitlements
  add constraint product_entitlements_offer_eligibility_pending_only
  check (
    authority_kind is distinct from 'OFFER_ELIGIBILITY'
    or (product = 'PERSONAL' and status = 'PENDING')
  );

create table entry_identity.personal_billing_accounts (
  canonical_user_id uuid primary key references auth.users(id) on delete restrict,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  selected_offer entry_identity.personal_commercial_offer not null,
  setup_fee_paid_at timestamptz,
  normalized_state entry_identity.personal_billing_state not null default 'PENDING_CHECKOUT',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  payment_method_required boolean not null default false,
  grace_started_at timestamptz,
  grace_until timestamptz,
  sotf_qualifying_paid_cycles smallint not null default 0,
  latest_reconciled_object_type text,
  latest_reconciled_object_id text,
  latest_reconciliation_version bigint not null default 0,
  latest_stripe_event_id text,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_billing_accounts_customer_id_nonempty
    check (stripe_customer_id is null or btrim(stripe_customer_id) <> ''),
  constraint personal_billing_accounts_subscription_id_nonempty
    check (stripe_subscription_id is null or btrim(stripe_subscription_id) <> ''),
  constraint personal_billing_accounts_checkout_id_nonempty
    check (stripe_checkout_session_id is null or btrim(stripe_checkout_session_id) <> ''),
  constraint personal_billing_accounts_trial_window
    check (trial_ends_at is null or trial_started_at is null or trial_ends_at >= trial_started_at),
  constraint personal_billing_accounts_period_window
    check (current_period_ends_at is null or current_period_started_at is null or current_period_ends_at >= current_period_started_at),
  constraint personal_billing_accounts_grace_window
    check (grace_until is null or grace_started_at is null or grace_until >= grace_started_at),
  constraint personal_billing_accounts_paid_cycles
    check (sotf_qualifying_paid_cycles between 0 and 12),
  constraint personal_billing_accounts_reconciliation_version
    check (latest_reconciliation_version >= 0)
);

create table entry_identity.stripe_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references auth.users(id) on delete restrict,
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_object_id text not null,
  enforce_logical_object_dedupe boolean not null default false,
  invoice_amount_paid integer,
  qualifying_paid_cycle boolean not null default false,
  paid_cycle_applied_at timestamptz,
  reconciliation_version bigint not null,
  reconciliation_outcome text not null default 'RECEIVED'
    check (reconciliation_outcome in ('RECEIVED', 'APPLIED', 'IGNORED', 'FAILED')),
  stripe_event_created_at timestamptz not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint stripe_reconciliation_event_id_nonempty check (btrim(stripe_event_id) <> ''),
  constraint stripe_reconciliation_event_type_nonempty check (btrim(event_type) <> ''),
  constraint stripe_reconciliation_object_id_nonempty check (btrim(stripe_object_id) <> ''),
  constraint stripe_reconciliation_version_positive check (reconciliation_version > 0),
  constraint stripe_reconciliation_invoice_amount check (invoice_amount_paid is null or invoice_amount_paid >= 0),
  constraint stripe_reconciliation_qualifying_paid_cycle check (
    not qualifying_paid_cycle
    or (
      event_type = 'invoice.paid'
      and invoice_amount_paid > 0
      and enforce_logical_object_dedupe
    )
  )
);

create unique index stripe_reconciliation_events_logical_object_unique
  on entry_identity.stripe_reconciliation_events (event_type, stripe_object_id)
  where enforce_logical_object_dedupe;

create index stripe_reconciliation_events_canonical_user_id_idx
  on entry_identity.stripe_reconciliation_events (canonical_user_id, reconciliation_version);

create table entry_identity.billing_cutover_control (
  setting_key text primary key check (setting_key = 'phase_2_2_billing_enforcement_enabled'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into entry_identity.billing_cutover_control (setting_key, enabled)
values ('phase_2_2_billing_enforcement_enabled', false)
on conflict (setting_key) do nothing;

alter table entry_identity.personal_billing_accounts enable row level security;
alter table entry_identity.stripe_reconciliation_events enable row level security;
alter table entry_identity.billing_cutover_control enable row level security;

revoke all on entry_identity.personal_billing_accounts,
  entry_identity.stripe_reconciliation_events,
  entry_identity.billing_cutover_control from public, anon, authenticated;
grant select, insert, update on entry_identity.personal_billing_accounts to service_role;
grant select, insert, update on entry_identity.stripe_reconciliation_events to service_role;
grant select, update on entry_identity.billing_cutover_control to service_role;

-- Preserve the existing audited command and signature. Only future writes with
-- the two exact recognized sources acquire an authority kind; existing rows are
-- deliberately not backfilled or reclassified in this slice.
create or replace function public.set_entry_product_entitlement(
  p_canonical_user_id uuid,
  p_product entry_identity.entry_product,
  p_status entry_identity.entitlement_status,
  p_source text,
  p_display_name text default null
) returns table(entitlement_id uuid, effective_status entry_identity.entitlement_status)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement_id uuid;
  v_source text := btrim(coalesce(p_source, ''));
  v_authority_kind entry_identity.entitlement_authority_kind;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if char_length(v_source) not between 1 and 120 then
    raise exception 'A concise entitlement source is required.' using errcode = '22023';
  end if;

  if v_source = 'sotf_founding_fellow_2026' then
    if p_product <> 'PERSONAL' or p_status <> 'PENDING' then
      raise exception 'SOTF offer eligibility must be a pending Personal entitlement.' using errcode = '22023';
    end if;
    v_authority_kind := 'OFFER_ELIGIBILITY';
  elsif v_source = 'phase_2_1_prebilling_automatic_personal' then
    v_authority_kind := 'LEGACY_PREBILLING';
  end if;

  if p_display_name is not null and btrim(p_display_name) <> '' then
    insert into entry_identity.identity_profiles(canonical_user_id, display_name)
    values (p_canonical_user_id, left(btrim(p_display_name), 200))
    on conflict (canonical_user_id) do update
      set display_name = excluded.display_name,
          updated_at = now();
  end if;

  insert into entry_identity.product_entitlements(
    canonical_user_id, product, status, granted_at, revoked_at, granted_by, source, authority_kind
  ) values (
    p_canonical_user_id,
    p_product,
    p_status,
    case when p_status = 'ACTIVE' then now() else null end,
    case when p_status = 'REVOKED' then now() else null end,
    p_canonical_user_id,
    v_source,
    v_authority_kind
  )
  on conflict (canonical_user_id, product) do update
    set status = excluded.status,
        granted_at = case
          when excluded.status = 'ACTIVE' then coalesce(entry_identity.product_entitlements.granted_at, now())
          else entry_identity.product_entitlements.granted_at
        end,
        revoked_at = case when excluded.status = 'REVOKED' then now() else null end,
        granted_by = excluded.granted_by,
        source = excluded.source,
        authority_kind = coalesce(excluded.authority_kind, entry_identity.product_entitlements.authority_kind),
        updated_at = now()
  returning id into v_entitlement_id;

  insert into entry_identity.identity_audit_events(
    canonical_user_id, event_type, product, metadata
  ) values (
    p_canonical_user_id,
    'ENTRY_PRODUCT_ENTITLEMENT_SET',
    p_product,
    jsonb_build_object(
      'status', p_status,
      'source', v_source,
      'authority_kind', v_authority_kind
    )
  );

  return query select v_entitlement_id, p_status;
end;
$$;

revoke all on function public.set_entry_product_entitlement(
  uuid, entry_identity.entry_product, entry_identity.entitlement_status, text, text
) from public, anon, authenticated;
grant execute on function public.set_entry_product_entitlement(
  uuid, entry_identity.entry_product, entry_identity.entitlement_status, text, text
) to service_role;

comment on column entry_identity.product_entitlements.authority_kind is
  'Explicit authority category for future cutover. NULL preserves unclassified historical rows without reclassification.';
comment on table entry_identity.personal_billing_accounts is
  'Private Entry-owned canonical billing state. Stripe identifiers never become Workspace authority.';
comment on table entry_identity.stripe_reconciliation_events is
  'Private Stripe event ledger. Logical-object dedupe is enabled only for event types that require exactly-once application.';
comment on table entry_identity.billing_cutover_control is
  'Server-owned Phase 2.2 enforcement switch. The installed default is disabled.';
