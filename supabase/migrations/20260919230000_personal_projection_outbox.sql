-- Phase 2.2 Slice D: transactional PERSONAL projection outbox and Entry-side
-- effective-access resolver. Delivery remains external to the canonical write
-- transaction, and the Phase 2.2 cutover remains disabled.

do $$ begin
  create type entry_identity.personal_projection_kind as enum (
    'BILLING',
    'NON_BILLING_AUTHORITY'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_identity.personal_projection_delivery_state as enum (
    'PENDING',
    'DELIVERED'
  );
exception when duplicate_object then null; end $$;

create table entry_identity.personal_projection_outbox (
  projection_version bigint generated always as identity primary key,
  delivery_id uuid not null default gen_random_uuid() unique,
  canonical_user_id uuid not null references auth.users(id) on delete restrict,
  projection_kind entry_identity.personal_projection_kind not null,
  projection_data jsonb not null,
  delivery_state entry_identity.personal_projection_delivery_state not null default 'PENDING',
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint personal_projection_outbox_payload_object
    check (jsonb_typeof(projection_data) = 'object'),
  constraint personal_projection_outbox_attempts_nonnegative
    check (attempts >= 0),
  constraint personal_projection_outbox_error_sanitized
    check (last_error is null or char_length(last_error) between 1 and 200),
  constraint personal_projection_outbox_delivery_consistent
    check (
      (delivery_state = 'PENDING' and delivered_at is null)
      or (delivery_state = 'DELIVERED' and delivered_at is not null and last_error is null)
    )
);

create index personal_projection_outbox_pending_idx
  on entry_identity.personal_projection_outbox (projection_version)
  where delivery_state = 'PENDING';

alter table entry_identity.personal_projection_outbox enable row level security;
revoke all on entry_identity.personal_projection_outbox from public, anon, authenticated;
grant select, insert, update on entry_identity.personal_projection_outbox to service_role;

create or replace function entry_identity.enqueue_personal_billing_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Checkout reservation is deliberately non-authoritative. Only a reconciled
  -- access state can create a Workspace billing projection.
  if new.latest_reconciliation_version <= 0
    or new.normalized_state not in (
      'TRIALING',
      'ACTIVE',
      'PAYMENT_GRACE',
      'PAUSED_NO_PAYMENT_METHOD',
      'SUSPENDED_PAYMENT',
      'CANCEL_AT_PERIOD_END',
      'CANCELED'
    )
    or (
      tg_op = 'UPDATE'
      and new.latest_reconciliation_version = old.latest_reconciliation_version
    )
  then
    return new;
  end if;

  insert into entry_identity.personal_projection_outbox (
    canonical_user_id,
    projection_kind,
    projection_data
  ) values (
    new.canonical_user_id,
    'BILLING',
    jsonb_build_object(
      'effective_state', new.normalized_state,
      'trial_started_at', new.trial_started_at,
      'trial_ends_at', new.trial_ends_at,
      'current_period_started_at', new.current_period_started_at,
      'current_period_ends_at', new.current_period_ends_at,
      'grace_until', new.grace_until,
      'cancel_at_period_end', new.cancel_at_period_end,
      'payment_method_required', new.payment_method_required
    )
  );
  return new;
end;
$$;

create trigger personal_billing_projection_outbox_after_write
after insert or update on entry_identity.personal_billing_accounts
for each row execute function entry_identity.enqueue_personal_billing_projection();

create or replace function entry_identity.enqueue_personal_access_authority_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.product <> 'PERSONAL'
    or new.authority_kind::text not in ('SPONSORED_ACCESS', 'INTERNAL_OPERATOR')
    or new.status not in ('ACTIVE', 'SUSPENDED', 'REVOKED')
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.authority_kind is not distinct from old.authority_kind
    and new.status is not distinct from old.status
    and new.source is not distinct from old.source
  then
    return new;
  end if;

  insert into entry_identity.personal_projection_outbox (
    canonical_user_id,
    projection_kind,
    projection_data
  ) values (
    new.canonical_user_id,
    'NON_BILLING_AUTHORITY',
    jsonb_build_object(
      'authority_kind', new.authority_kind,
      'entitlement_status', new.status,
      'source', new.source
    )
  );
  return new;
end;
$$;

create trigger personal_access_authority_projection_outbox_after_write
after insert or update on entry_identity.product_entitlements
for each row execute function entry_identity.enqueue_personal_access_authority_projection();

create or replace function public.claim_entry_personal_projection_batch(
  p_limit integer default 10
) returns table(
  delivery_id uuid,
  projection_kind entry_identity.personal_projection_kind,
  projection_version bigint,
  canonical_user_id uuid,
  projected_at timestamptz,
  projection_data jsonb,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_limit not between 1 and 25 then
    raise exception 'Projection batch size must be between 1 and 25.' using errcode = '22023';
  end if;

  return query
  with pending as (
    select outbox.projection_version
    from entry_identity.personal_projection_outbox as outbox
    where outbox.delivery_state = 'PENDING'
    order by outbox.projection_version
    limit p_limit
    for update skip locked
  ), claimed as (
    update entry_identity.personal_projection_outbox as outbox
    set attempts = outbox.attempts + 1,
        last_attempt_at = now()
    from pending
    where outbox.projection_version = pending.projection_version
    returning outbox.*
  )
  select
    claimed.delivery_id,
    claimed.projection_kind,
    claimed.projection_version,
    claimed.canonical_user_id,
    claimed.created_at,
    claimed.projection_data,
    claimed.attempts
  from claimed
  order by claimed.projection_version;
end;
$$;

create or replace function public.mark_entry_personal_projection_delivery(
  p_delivery_id uuid,
  p_delivered boolean,
  p_sanitized_error text default null
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error text := nullif(left(btrim(coalesce(p_sanitized_error, '')), 200), '');
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if not p_delivered and v_error is null then
    raise exception 'A sanitized delivery error is required.' using errcode = '22023';
  end if;

  update entry_identity.personal_projection_outbox as outbox
  set delivery_state = case when p_delivered then 'DELIVERED' else 'PENDING' end,
      delivered_at = case when p_delivered then coalesce(outbox.delivered_at, now()) else null end,
      last_error = case when p_delivered then null else v_error end
  where outbox.delivery_id = p_delivery_id
    and outbox.delivery_state = 'PENDING';
  return found;
end;
$$;

create or replace function public.get_entry_personal_projection_lag()
returns table(pending_count bigint, oldest_pending_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  return query
  select count(*), min(outbox.created_at)
  from entry_identity.personal_projection_outbox as outbox
  where outbox.delivery_state = 'PENDING';
end;
$$;

create or replace function entry_identity.has_effective_personal_access(
  p_canonical_user_id uuid,
  p_evaluated_at timestamptz default now()
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not coalesce((
      select control.enabled
      from entry_identity.billing_cutover_control as control
      where control.setting_key = 'phase_2_2_billing_enforcement_enabled'
    ), false)
    then exists (
      select 1
      from entry_identity.product_entitlements as entitlement
      where entitlement.canonical_user_id = p_canonical_user_id
        and entitlement.product = 'PERSONAL'
        and entitlement.status = 'ACTIVE'
    )
    else (
      exists (
        select 1
        from entry_identity.personal_billing_accounts as account
        where account.canonical_user_id = p_canonical_user_id
          and (
            account.normalized_state in ('TRIALING', 'ACTIVE')
            or (
              account.normalized_state = 'PAYMENT_GRACE'
              and account.grace_until is not null
              and account.grace_until > p_evaluated_at
            )
            or (
              account.normalized_state = 'CANCEL_AT_PERIOD_END'
              and account.current_period_ends_at is not null
              and account.current_period_ends_at > p_evaluated_at
            )
          )
      )
      or exists (
        select 1
        from entry_identity.product_entitlements as entitlement
        where entitlement.canonical_user_id = p_canonical_user_id
          and entitlement.product = 'PERSONAL'
          and entitlement.status = 'ACTIVE'
          and entitlement.authority_kind::text in ('SPONSORED_ACCESS', 'INTERNAL_OPERATOR')
      )
    )
  end;
$$;

create or replace function public.get_my_active_entry_products()
returns table(product entry_identity.entry_product)
language sql
stable
security definer
set search_path = ''
as $$
  select entitlement.product
  from entry_identity.product_entitlements as entitlement
  where entitlement.canonical_user_id = auth.uid()
    and entitlement.product <> 'PERSONAL'
    and entitlement.status = 'ACTIVE'
  union all
  select 'PERSONAL'::entry_identity.entry_product
  where auth.uid() is not null
    and entry_identity.has_effective_personal_access(auth.uid(), now())
  order by product;
$$;

revoke all on function entry_identity.enqueue_personal_billing_projection() from public, anon, authenticated;
revoke all on function entry_identity.enqueue_personal_access_authority_projection() from public, anon, authenticated;
revoke all on function public.claim_entry_personal_projection_batch(integer) from public, anon, authenticated;
revoke all on function public.mark_entry_personal_projection_delivery(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.get_entry_personal_projection_lag() from public, anon, authenticated;
revoke all on function entry_identity.has_effective_personal_access(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_my_active_entry_products() from public, anon;

grant execute on function public.claim_entry_personal_projection_batch(integer) to service_role;
grant execute on function public.mark_entry_personal_projection_delivery(uuid, boolean, text) to service_role;
grant execute on function public.get_entry_personal_projection_lag() to service_role;
grant execute on function entry_identity.has_effective_personal_access(uuid, timestamptz) to service_role;
grant execute on function public.get_my_active_entry_products() to authenticated, service_role;

comment on table entry_identity.personal_projection_outbox is
  'Transactional, PERSONAL-only normalized projection delivery state. It is not a generalized event bus.';
comment on column entry_identity.personal_projection_outbox.projection_version is
  'Global monotonic projection version and outbox ordering authority.';
comment on function entry_identity.has_effective_personal_access(uuid, timestamptz) is
  'Entry PERSONAL authority resolver. Phase 2.1 behavior is preserved until the existing cutover setting is enabled.';
