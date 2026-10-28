import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { CheckoutOffer } from '@/lib/billing/checkout';

export type CheckoutReservation = {
  disposition: 'RESERVED' | 'IN_PROGRESS' | 'EXISTING_SESSION';
  stripeCustomerId: string | null;
  selectedOffer: CheckoutOffer;
  checkoutReference: string | null;
};

export type CheckoutBillingStore = {
  isSotfEligible(canonicalUserId: string): Promise<boolean>;
  reserve(input: {
    canonicalUserId: string;
    offer: CheckoutOffer;
    reservationId: string;
    replaceCheckoutReference: string | null;
  }): Promise<CheckoutReservation>;
  complete(input: {
    canonicalUserId: string;
    offer: CheckoutOffer;
    reservationId: string;
    stripeCustomerId: string;
    stripeCheckoutSessionId: string;
  }): Promise<boolean>;
  release(canonicalUserId: string, reservationId: string): Promise<void>;
};

export type BillingState =
  | 'PENDING_CHECKOUT'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAYMENT_GRACE'
  | 'PAUSED_NO_PAYMENT_METHOD'
  | 'SUSPENDED_PAYMENT'
  | 'CANCEL_AT_PERIOD_END'
  | 'CANCELED'
  | 'INTERNAL_OPERATOR';

export type BillingReconciliationContext = {
  canonicalUserId: string;
  selectedOffer: CheckoutOffer;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  setupFeePaidAt: string | null;
  normalizedState: BillingState;
  paymentMethodRequired: boolean;
  graceStartedAt: string | null;
  graceUntil: string | null;
  sotfQualifyingPaidCycles: number;
};

export type ApplyReconciliationInput = {
  canonicalUserId: string;
  stripeEventId: string;
  eventType: string;
  stripeObjectId: string;
  stripeEventCreatedAt: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeCheckoutSessionId: string | null;
  normalizedState: BillingState | null;
  setupFeePaidAt: string | null;
  paymentMethodRequired: boolean | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean | null;
  invoiceAmountPaid: number | null;
  qualifyingPaidCycle: boolean;
  startGraceAt: string | null;
  clearGrace: boolean;
  enforceLogicalObjectDedupe: boolean;
  reconciliationOutcome: 'APPLIED' | 'IGNORED';
};

export type ReconciliationApplication = {
  applicationResult: 'APPLIED' | 'IGNORED' | 'DUPLICATE';
  resultingState: BillingState;
  effectiveState: BillingState;
  resultingPaidCycles: number;
};

export type BillingReconciliationStore = {
  resolveByCustomer(stripeCustomerId: string): Promise<BillingReconciliationContext | null>;
  apply(input: ApplyReconciliationInput): Promise<ReconciliationApplication>;
};

export type BillingLifecycleContext = {
  canonicalUserId: string;
  selectedOffer: CheckoutOffer;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  normalizedState: BillingState;
  paymentMethodRequired: boolean;
  graceUntil: string | null;
  sotfQualifyingPaidCycles: number;
  discountRemovalDue: boolean;
  discountRemovedAt: string | null;
};

export type SotfDiscountRemovalCandidate = {
  canonicalUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  sotfQualifyingPaidCycles: number;
  discountRemovalAttemptCount: number;
};

export type BillingLifecycleStore = {
  resolveByCanonicalUser(canonicalUserId: string): Promise<BillingLifecycleContext | null>;
  listPendingDiscountRemovals(limit: number): Promise<SotfDiscountRemovalCandidate[]>;
  recordDiscountRemovalAttempt(input: {
    canonicalUserId: string;
    succeeded: boolean;
    errorCode: string | null;
  }): Promise<void>;
};

type ReservationRow = {
  reservation_disposition: CheckoutReservation['disposition'];
  stripe_customer_id: string | null;
  selected_offer: CheckoutOffer;
  checkout_reference: string | null;
};

type ReconciliationContextRow = {
  canonical_user_id: string;
  selected_offer: CheckoutOffer;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  setup_fee_paid_at: string | null;
  normalized_state: BillingState;
  payment_method_required: boolean;
  grace_started_at: string | null;
  grace_until: string | null;
  sotf_qualifying_paid_cycles: number;
};

type ReconciliationApplicationRow = {
  application_result: ReconciliationApplication['applicationResult'];
  resulting_state: BillingState;
  effective_state: BillingState;
  resulting_paid_cycles: number;
};

type LifecycleContextRow = {
  canonical_user_id: string;
  selected_offer: CheckoutOffer;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  normalized_state: BillingState;
  payment_method_required: boolean;
  grace_until: string | null;
  sotf_qualifying_paid_cycles: number;
  discount_removal_due: boolean;
  discount_removed_at: string | null;
};

type DiscountRemovalCandidateRow = {
  canonical_user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  sotf_qualifying_paid_cycles: number;
  discount_removal_attempt_count: number;
};

function createBillingServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('Entry billing database configuration is incomplete');
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function createEntryBillingStore(): CheckoutBillingStore {
  const service = createBillingServiceClient();

  return {
    async isSotfEligible(canonicalUserId) {
      const { data, error } = await service.rpc('has_entry_sotf_checkout_eligibility', {
        p_canonical_user_id: canonicalUserId,
      });
      if (error) throw new Error('SOTF Checkout eligibility could not be verified');
      return data === true;
    },

    async reserve(input) {
      const { data, error } = await service.rpc('reserve_entry_billing_checkout', {
        p_canonical_user_id: input.canonicalUserId,
        p_offer: input.offer,
        p_reservation_id: input.reservationId,
        p_replace_checkout_reference: input.replaceCheckoutReference,
      });
      if (error) throw new Error('Checkout reservation could not be acquired');
      const row = (data as ReservationRow[] | null)?.[0];
      if (!row) throw new Error('Checkout reservation returned no state');
      return {
        disposition: row.reservation_disposition,
        stripeCustomerId: row.stripe_customer_id,
        selectedOffer: row.selected_offer,
        checkoutReference: row.checkout_reference,
      };
    },

    async complete(input) {
      const { data, error } = await service.rpc('complete_entry_billing_checkout', {
        p_canonical_user_id: input.canonicalUserId,
        p_offer: input.offer,
        p_reservation_id: input.reservationId,
        p_stripe_customer_id: input.stripeCustomerId,
        p_stripe_checkout_session_id: input.stripeCheckoutSessionId,
      });
      if (error) throw new Error('Checkout ownership could not be persisted');
      return data === true;
    },

    async release(canonicalUserId, reservationId) {
      const { error } = await service.rpc('release_entry_billing_checkout_reservation', {
        p_canonical_user_id: canonicalUserId,
        p_reservation_id: reservationId,
      });
      if (error) throw new Error('Checkout reservation could not be released');
    },
  };
}

export function createEntryBillingReconciliationStore(): BillingReconciliationStore {
  const service = createBillingServiceClient();
  return {
    async resolveByCustomer(stripeCustomerId) {
      const { data, error } = await service.rpc('get_entry_billing_reconciliation_context', {
        p_stripe_customer_id: stripeCustomerId,
      });
      if (error) throw new Error('Stripe ownership could not be resolved');
      const rows = data as ReconciliationContextRow[] | null;
      if (!rows?.length) return null;
      if (rows.length !== 1) throw new Error('Stripe Customer ownership is ambiguous');
      const row = rows[0];
      return {
        canonicalUserId: row.canonical_user_id,
        selectedOffer: row.selected_offer,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        setupFeePaidAt: row.setup_fee_paid_at,
        normalizedState: row.normalized_state,
        paymentMethodRequired: row.payment_method_required,
        graceStartedAt: row.grace_started_at,
        graceUntil: row.grace_until,
        sotfQualifyingPaidCycles: row.sotf_qualifying_paid_cycles,
      };
    },

    async apply(input) {
      const { data, error } = await service.rpc('apply_entry_stripe_reconciliation', {
        p_canonical_user_id: input.canonicalUserId,
        p_stripe_event_id: input.stripeEventId,
        p_event_type: input.eventType,
        p_stripe_object_id: input.stripeObjectId,
        p_stripe_event_created_at: input.stripeEventCreatedAt,
        p_stripe_customer_id: input.stripeCustomerId,
        p_stripe_subscription_id: input.stripeSubscriptionId,
        p_stripe_checkout_session_id: input.stripeCheckoutSessionId,
        p_normalized_state: input.normalizedState,
        p_setup_fee_paid_at: input.setupFeePaidAt,
        p_payment_method_required: input.paymentMethodRequired,
        p_trial_started_at: input.trialStartedAt,
        p_trial_ends_at: input.trialEndsAt,
        p_current_period_started_at: input.currentPeriodStartedAt,
        p_current_period_ends_at: input.currentPeriodEndsAt,
        p_cancel_at_period_end: input.cancelAtPeriodEnd,
        p_invoice_amount_paid: input.invoiceAmountPaid,
        p_qualifying_paid_cycle: input.qualifyingPaidCycle,
        p_start_grace_at: input.startGraceAt,
        p_clear_grace: input.clearGrace,
        p_enforce_logical_object_dedupe: input.enforceLogicalObjectDedupe,
        p_reconciliation_outcome: input.reconciliationOutcome,
      });
      if (error) throw new Error('Stripe reconciliation could not be applied');
      const row = (data as ReconciliationApplicationRow[] | null)?.[0];
      if (!row) throw new Error('Stripe reconciliation returned no state');
      return {
        applicationResult: row.application_result,
        resultingState: row.resulting_state,
        effectiveState: row.effective_state,
        resultingPaidCycles: row.resulting_paid_cycles,
      };
    },
  };
}

export function createEntryBillingLifecycleStore(): BillingLifecycleStore {
  const service = createBillingServiceClient();
  return {
    async resolveByCanonicalUser(canonicalUserId) {
      const { data, error } = await service.rpc('get_entry_billing_lifecycle_context', {
        p_canonical_user_id: canonicalUserId,
      });
      if (error) throw new Error('Billing lifecycle ownership could not be resolved');
      const rows = data as LifecycleContextRow[] | null;
      if (!rows?.length) return null;
      if (rows.length !== 1) throw new Error('Canonical billing ownership is ambiguous');
      const row = rows[0];
      return {
        canonicalUserId: row.canonical_user_id,
        selectedOffer: row.selected_offer,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        normalizedState: row.normalized_state,
        paymentMethodRequired: row.payment_method_required,
        graceUntil: row.grace_until,
        sotfQualifyingPaidCycles: row.sotf_qualifying_paid_cycles,
        discountRemovalDue: row.discount_removal_due,
        discountRemovedAt: row.discount_removed_at,
      };
    },

    async listPendingDiscountRemovals(limit) {
      const { data, error } = await service.rpc('get_pending_entry_sotf_discount_removals', {
        p_limit: limit,
      });
      if (error) throw new Error('Pending SOTF discount removals could not be loaded');
      return ((data ?? []) as DiscountRemovalCandidateRow[]).map((row) => ({
        canonicalUserId: row.canonical_user_id,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        sotfQualifyingPaidCycles: row.sotf_qualifying_paid_cycles,
        discountRemovalAttemptCount: row.discount_removal_attempt_count,
      }));
    },

    async recordDiscountRemovalAttempt(input) {
      const { error } = await service.rpc('record_entry_sotf_discount_removal_attempt', {
        p_canonical_user_id: input.canonicalUserId,
        p_succeeded: input.succeeded,
        p_error_code: input.errorCode,
      });
      if (error) throw new Error('SOTF discount-removal evidence could not be recorded');
    },
  };
}
