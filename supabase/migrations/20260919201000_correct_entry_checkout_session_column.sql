-- Phase 2.2 Slice B bounded correction: use the accepted Slice A
-- stripe_checkout_session_id column in the three Checkout state RPCs.

create or replace function public.reserve_entry_billing_checkout(
  p_canonical_user_id uuid,
  p_offer entry_identity.personal_commercial_offer,
  p_reservation_id text,
  p_replace_checkout_reference text
) returns table(
  reservation_disposition text,
  stripe_customer_id text,
  selected_offer entry_identity.personal_commercial_offer,
  checkout_reference text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account entry_identity.personal_billing_accounts%rowtype;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_reservation_id !~ '^checkout_attempt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A valid Checkout reservation identifier is required.' using errcode = '22023';
  end if;

  insert into entry_identity.personal_billing_accounts(
    canonical_user_id,
    selected_offer,
    stripe_checkout_session_id,
    normalized_state
  ) values (
    p_canonical_user_id,
    p_offer,
    p_reservation_id,
    'PENDING_CHECKOUT'
  )
  on conflict (canonical_user_id) do nothing;

  select * into v_account
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id = p_canonical_user_id
  for update;

  if v_account.stripe_checkout_session_id = p_reservation_id then
    return query select
      'RESERVED'::text,
      v_account.stripe_customer_id,
      v_account.selected_offer,
      v_account.stripe_checkout_session_id;
    return;
  end if;

  if v_account.stripe_checkout_session_id is null
    or (
      v_account.stripe_checkout_session_id like 'checkout_attempt_%'
      and v_account.updated_at < now() - interval '5 minutes'
    )
    or (
      p_replace_checkout_reference is not null
      and v_account.stripe_checkout_session_id = p_replace_checkout_reference
    )
  then
    update entry_identity.personal_billing_accounts account
    set selected_offer = p_offer,
        stripe_checkout_session_id = p_reservation_id,
        normalized_state = 'PENDING_CHECKOUT',
        updated_at = now()
    where account.canonical_user_id = p_canonical_user_id;

    return query select
      'RESERVED'::text,
      v_account.stripe_customer_id,
      p_offer,
      p_reservation_id;
    return;
  end if;

  if v_account.stripe_checkout_session_id like 'checkout_attempt_%' then
    return query select
      'IN_PROGRESS'::text,
      v_account.stripe_customer_id,
      v_account.selected_offer,
      v_account.stripe_checkout_session_id;
    return;
  end if;

  return query select
    'EXISTING_SESSION'::text,
    v_account.stripe_customer_id,
    v_account.selected_offer,
    v_account.stripe_checkout_session_id;
end;
$$;

create or replace function public.complete_entry_billing_checkout(
  p_canonical_user_id uuid,
  p_offer entry_identity.personal_commercial_offer,
  p_reservation_id text,
  p_stripe_customer_id text,
  p_stripe_checkout_session_id text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account entry_identity.personal_billing_accounts%rowtype;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_stripe_customer_id, '')) = ''
    or btrim(coalesce(p_stripe_checkout_session_id, '')) = ''
  then
    raise exception 'Stripe customer and Checkout session identifiers are required.' using errcode = '22023';
  end if;

  select * into v_account
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id = p_canonical_user_id
  for update;

  if not found
    or v_account.selected_offer <> p_offer
    or v_account.stripe_checkout_session_id <> p_reservation_id
  then
    return false;
  end if;
  if v_account.stripe_customer_id is not null
    and v_account.stripe_customer_id <> p_stripe_customer_id
  then
    raise exception 'Stripe customer ownership conflict.' using errcode = '23505';
  end if;

  update entry_identity.personal_billing_accounts account
  set stripe_customer_id = coalesce(account.stripe_customer_id, p_stripe_customer_id),
      stripe_checkout_session_id = p_stripe_checkout_session_id,
      updated_at = now()
  where account.canonical_user_id = p_canonical_user_id;

  insert into entry_identity.identity_audit_events(
    canonical_user_id,
    event_type,
    product,
    metadata
  ) values (
    p_canonical_user_id,
    'ENTRY_BILLING_CHECKOUT_CREATED',
    'PERSONAL',
    jsonb_build_object(
      'commercial_offer', p_offer,
      'checkout_attempt_id', p_reservation_id,
      'checkout_session_id', p_stripe_checkout_session_id
    )
  );

  return true;
end;
$$;

create or replace function public.release_entry_billing_checkout_reservation(
  p_canonical_user_id uuid,
  p_reservation_id text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;

  update entry_identity.personal_billing_accounts account
  set stripe_checkout_session_id = null,
      updated_at = now()
  where account.canonical_user_id = p_canonical_user_id
    and account.stripe_checkout_session_id = p_reservation_id;

  return found;
end;
$$;
