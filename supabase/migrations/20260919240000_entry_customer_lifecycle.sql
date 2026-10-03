-- Phase 2.2 Slice E: Entry customer lifecycle completion.
-- Adds only the durable evidence required to retry the SOTF founding-discount
-- removal after the twelfth successfully paid recurring invoice.

alter table entry_identity.personal_billing_accounts
  add column discount_removal_due boolean not null default false,
  add column discount_removal_attempt_count integer not null default 0,
  add column discount_removal_last_attempt_at timestamptz,
  add column discount_removal_last_error_code text,
  add column discount_removed_at timestamptz;

alter table entry_identity.personal_billing_accounts
  add constraint personal_billing_accounts_discount_removal_attempt_count
    check (discount_removal_attempt_count >= 0),
  add constraint personal_billing_accounts_discount_removal_error_code
    check (
      discount_removal_last_error_code is null
      or (
        btrim(discount_removal_last_error_code) <> ''
        and char_length(discount_removal_last_error_code) <= 80
        and discount_removal_last_error_code ~ '^[A-Z0-9_]+$'
      )
    ),
  add constraint personal_billing_accounts_discount_removal_evidence
    check (
      (discount_removal_attempt_count = 0) = (discount_removal_last_attempt_at is null)
      and (discount_removal_last_error_code is null or discount_removal_last_attempt_at is not null)
    ),
  add constraint personal_billing_accounts_discount_removal_scope
    check (
      selected_offer = 'SOTF_FOUNDING_FELLOW'
      or (
        not discount_removal_due
        and discount_removal_attempt_count = 0
        and discount_removal_last_attempt_at is null
        and discount_removal_last_error_code is null
        and discount_removed_at is null
      )
    ),
  add constraint personal_billing_accounts_discount_removal_state
    check (
      (not discount_removal_due or (
        sotf_qualifying_paid_cycles = 12
        and discount_removed_at is null
      ))
      and (discount_removed_at is null or (
        sotf_qualifying_paid_cycles = 12
        and not discount_removal_due
      ))
    );

create function entry_identity.set_sotf_discount_removal_due()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.selected_offer = 'SOTF_FOUNDING_FELLOW'
    and new.sotf_qualifying_paid_cycles = 12
    and new.discount_removed_at is null
    and (
      tg_op = 'INSERT'
      or old.sotf_qualifying_paid_cycles < 12
    )
  then
    new.discount_removal_due := true;
  end if;
  return new;
end;
$$;

create trigger personal_billing_accounts_set_discount_removal_due
before insert or update of sotf_qualifying_paid_cycles
on entry_identity.personal_billing_accounts
for each row execute function entry_identity.set_sotf_discount_removal_due();

-- Any accepted pre-migration account already at the deterministic boundary is
-- queued for inspection; the worker treats an already-absent discount as a
-- successful, idempotent completion.
update entry_identity.personal_billing_accounts
set discount_removal_due = true,
    updated_at = now()
where selected_offer = 'SOTF_FOUNDING_FELLOW'
  and sotf_qualifying_paid_cycles = 12
  and discount_removed_at is null;

create function public.get_entry_billing_lifecycle_context(
  p_canonical_user_id uuid
) returns table(
  canonical_user_id uuid,
  selected_offer entry_identity.personal_commercial_offer,
  stripe_customer_id text,
  stripe_subscription_id text,
  normalized_state entry_identity.personal_billing_state,
  payment_method_required boolean,
  grace_until timestamptz,
  sotf_qualifying_paid_cycles smallint,
  discount_removal_due boolean,
  discount_removed_at timestamptz
)
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
  select
    account.canonical_user_id,
    account.selected_offer,
    account.stripe_customer_id,
    account.stripe_subscription_id,
    account.normalized_state,
    account.payment_method_required,
    account.grace_until,
    account.sotf_qualifying_paid_cycles,
    account.discount_removal_due,
    account.discount_removed_at
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id = p_canonical_user_id;
end;
$$;

create function public.get_pending_entry_sotf_discount_removals(
  p_limit integer default 5
) returns table(
  canonical_user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  sotf_qualifying_paid_cycles smallint,
  discount_removal_attempt_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_limit not between 1 and 20 then
    raise exception 'Discount-removal batch limit must be between 1 and 20.' using errcode = '22023';
  end if;

  return query
  select
    account.canonical_user_id,
    account.stripe_customer_id,
    account.stripe_subscription_id,
    account.sotf_qualifying_paid_cycles,
    account.discount_removal_attempt_count
  from entry_identity.personal_billing_accounts account
  where account.selected_offer = 'SOTF_FOUNDING_FELLOW'
    and account.sotf_qualifying_paid_cycles = 12
    and account.discount_removal_due
    and account.discount_removed_at is null
    and account.stripe_customer_id is not null
    and account.stripe_subscription_id is not null
  order by account.discount_removal_last_attempt_at nulls first,
    account.updated_at,
    account.canonical_user_id
  limit p_limit;
end;
$$;

create function public.record_entry_sotf_discount_removal_attempt(
  p_canonical_user_id uuid,
  p_succeeded boolean,
  p_error_code text default null
) returns table(
  discount_removal_due boolean,
  discount_removal_attempt_count integer,
  discount_removed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account entry_identity.personal_billing_accounts%rowtype;
  v_error_code text := nullif(btrim(coalesce(p_error_code, '')), '');
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if not p_succeeded and (
    v_error_code is null
    or char_length(v_error_code) > 80
    or v_error_code !~ '^[A-Z0-9_]+$'
  ) then
    raise exception 'A sanitized discount-removal error code is required.' using errcode = '22023';
  end if;

  select * into v_account
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id = p_canonical_user_id
  for update;

  if not found then
    raise exception 'Canonical billing account was not found.' using errcode = 'P0002';
  end if;
  if v_account.selected_offer <> 'SOTF_FOUNDING_FELLOW'
    or v_account.sotf_qualifying_paid_cycles <> 12
  then
    raise exception 'SOTF discount removal is not due.' using errcode = '22023';
  end if;

  -- A late duplicate failure cannot reopen an already-completed removal.
  if v_account.discount_removed_at is not null then
    return query select
      v_account.discount_removal_due,
      v_account.discount_removal_attempt_count,
      v_account.discount_removed_at;
    return;
  end if;

  update entry_identity.personal_billing_accounts account
  set discount_removal_due = not p_succeeded,
      discount_removal_attempt_count = account.discount_removal_attempt_count + 1,
      discount_removal_last_attempt_at = now(),
      discount_removal_last_error_code = case when p_succeeded then null else v_error_code end,
      discount_removed_at = case when p_succeeded then now() else null end,
      updated_at = now()
  where account.canonical_user_id = p_canonical_user_id
  returning * into v_account;

  return query select
    v_account.discount_removal_due,
    v_account.discount_removal_attempt_count,
    v_account.discount_removed_at;
end;
$$;

revoke all on function entry_identity.set_sotf_discount_removal_due()
  from public, anon, authenticated;
revoke all on function public.get_entry_billing_lifecycle_context(uuid)
  from public, anon, authenticated;
revoke all on function public.get_pending_entry_sotf_discount_removals(integer)
  from public, anon, authenticated;
revoke all on function public.record_entry_sotf_discount_removal_attempt(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function public.get_entry_billing_lifecycle_context(uuid)
  to service_role;
grant execute on function public.get_pending_entry_sotf_discount_removals(integer)
  to service_role;
grant execute on function public.record_entry_sotf_discount_removal_attempt(uuid, boolean, text)
  to service_role;

comment on function public.record_entry_sotf_discount_removal_attempt(uuid, boolean, text)
  is 'Records retryable Entry-only SOTF founding-discount removal evidence without changing billing state or enabling cutover.';
