-- Forward-only repair of existing service-only reconciliation guards.
-- Preserve signature, privileges, replay protection and unrelated billing behavior.
-- No customer backfill or change to the already-applied migration.

create or replace function public.apply_entry_stripe_reconciliation(
  p_canonical_user_id uuid,
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_object_id text,
  p_stripe_event_created_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_checkout_session_id text,
  p_normalized_state entry_identity.personal_billing_state,
  p_setup_fee_paid_at timestamptz,
  p_payment_method_required boolean,
  p_trial_started_at timestamptz,
  p_trial_ends_at timestamptz,
  p_current_period_started_at timestamptz,
  p_current_period_ends_at timestamptz,
  p_cancel_at_period_end boolean,
  p_invoice_amount_paid integer,
  p_qualifying_paid_cycle boolean,
  p_start_grace_at timestamptz,
  p_clear_grace boolean,
  p_enforce_logical_object_dedupe boolean,
  p_reconciliation_outcome text
) returns table(
  application_result text,
  resulting_state entry_identity.personal_billing_state,
  effective_state entry_identity.personal_billing_state,
  resulting_paid_cycles smallint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account entry_identity.personal_billing_accounts%rowtype;
  v_event_id uuid;
  v_version bigint;
  v_valid_paid_history boolean;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.expired',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed',
    'customer.subscription.trial_will_end',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.payment_action_required'
  ) then
    raise exception 'Unsupported Stripe event type.' using errcode = '22023';
  end if;
  if p_reconciliation_outcome not in ('APPLIED', 'IGNORED') then
    raise exception 'Invalid reconciliation outcome.' using errcode = '22023';
  end if;

  select * into v_account
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id = p_canonical_user_id
  for update;

  if not found or v_account.stripe_customer_id is null
    or v_account.stripe_customer_id is distinct from p_stripe_customer_id
  then
    raise exception 'Stripe Customer ownership mismatch.' using errcode = '23503';
  end if;
  if p_stripe_checkout_session_id is not null
    and v_account.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id
  then
    raise exception 'Stripe Checkout ownership mismatch.' using errcode = '23503';
  end if;
  if p_stripe_subscription_id is not null
    and v_account.stripe_subscription_id is not null
    and v_account.stripe_subscription_id <> p_stripe_subscription_id
  then
    raise exception 'Stripe Subscription ownership mismatch.' using errcode = '23503';
  end if;
  if p_qualifying_paid_cycle and (
    p_event_type <> 'invoice.paid'
    or v_account.selected_offer <> 'SOTF_FOUNDING_FELLOW'
    or p_invoice_amount_paid is distinct from 1900
    or not p_enforce_logical_object_dedupe
  ) then
    raise exception 'Invalid SOTF qualifying paid cycle.' using errcode = '22023';
  end if;

  v_version := v_account.latest_reconciliation_version + 1;
  insert into entry_identity.stripe_reconciliation_events(
    canonical_user_id,
    stripe_event_id,
    event_type,
    stripe_object_id,
    enforce_logical_object_dedupe,
    invoice_amount_paid,
    qualifying_paid_cycle,
    paid_cycle_applied_at,
    reconciliation_version,
    reconciliation_outcome,
    stripe_event_created_at
  ) values (
    p_canonical_user_id,
    p_stripe_event_id,
    p_event_type,
    p_stripe_object_id,
    p_enforce_logical_object_dedupe,
    p_invoice_amount_paid,
    p_qualifying_paid_cycle,
    case when p_qualifying_paid_cycle then now() else null end,
    v_version,
    p_reconciliation_outcome,
    p_stripe_event_created_at
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return query select
      'DUPLICATE'::text,
      v_account.normalized_state,
      case
        when v_account.normalized_state = 'PAYMENT_GRACE'
          and v_account.grace_until is not null
          and v_account.grace_until <= now()
        then 'SUSPENDED_PAYMENT'::entry_identity.personal_billing_state
        else v_account.normalized_state
      end,
      v_account.sotf_qualifying_paid_cycles;
    return;
  end if;

  v_valid_paid_history := v_account.setup_fee_paid_at is not null
    or v_account.sotf_qualifying_paid_cycles > 0;

  update entry_identity.personal_billing_accounts account
  set stripe_subscription_id = case
        when p_stripe_subscription_id is null then account.stripe_subscription_id
        else coalesce(account.stripe_subscription_id, p_stripe_subscription_id)
      end,
      setup_fee_paid_at = coalesce(account.setup_fee_paid_at, p_setup_fee_paid_at),
      normalized_state = case
        when p_start_grace_at is not null and v_valid_paid_history then 'PAYMENT_GRACE'
        when p_normalized_state is not null then p_normalized_state
        else account.normalized_state
      end,
      trial_started_at = coalesce(p_trial_started_at, account.trial_started_at),
      trial_ends_at = coalesce(p_trial_ends_at, account.trial_ends_at),
      current_period_started_at = coalesce(p_current_period_started_at, account.current_period_started_at),
      current_period_ends_at = coalesce(p_current_period_ends_at, account.current_period_ends_at),
      cancel_at_period_end = coalesce(p_cancel_at_period_end, account.cancel_at_period_end),
      payment_method_required = coalesce(p_payment_method_required, account.payment_method_required),
      grace_started_at = case
        when p_clear_grace then null
        when p_start_grace_at is not null and v_valid_paid_history
          then coalesce(account.grace_started_at, p_start_grace_at)
        else account.grace_started_at
      end,
      grace_until = case
        when p_clear_grace then null
        when p_start_grace_at is not null and v_valid_paid_history
          then coalesce(account.grace_until, p_start_grace_at + interval '7 days')
        else account.grace_until
      end,
      sotf_qualifying_paid_cycles = case
        when p_qualifying_paid_cycle
          then least(12, account.sotf_qualifying_paid_cycles + 1)
        else account.sotf_qualifying_paid_cycles
      end,
      latest_reconciled_object_type = p_event_type,
      latest_reconciled_object_id = p_stripe_object_id,
      latest_reconciliation_version = v_version,
      latest_stripe_event_id = p_stripe_event_id,
      last_reconciled_at = now(),
      updated_at = now()
  where account.canonical_user_id = p_canonical_user_id
  returning * into v_account;

  return query select
    p_reconciliation_outcome,
    v_account.normalized_state,
    case
      when v_account.normalized_state = 'PAYMENT_GRACE'
        and v_account.grace_until is not null
        and v_account.grace_until <= now()
      then 'SUSPENDED_PAYMENT'::entry_identity.personal_billing_state
      else v_account.normalized_state
    end,
    v_account.sotf_qualifying_paid_cycles;
end;
$$;
