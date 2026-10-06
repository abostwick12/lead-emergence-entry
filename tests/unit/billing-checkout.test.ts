import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('server-only', () => ({}));

import {
  BillingCheckoutError,
  buildCheckoutSessionParams,
  createCheckoutForUser,
} from '@/lib/billing/checkout';
import type { BillingConfig } from '@/lib/billing/config';
import type { CheckoutBillingStore, CheckoutReservation } from '@/lib/billing/store';

const canonicalUserId = '00000000-0000-4000-8000-0000000002b1';
const config: BillingConfig = {
  stripeSecretKey: 'sk_test_slice_b',
  monthlyPriceId: 'price_monthly_39',
  setupPriceId: 'price_setup_199',
  sotfCouponId: 'coupon_sotf_20',
  portalConfigurationId: 'bpc_slice_e',
  entryOrigin: 'https://entry.example.test',
};

function reservation(overrides: Partial<CheckoutReservation> = {}): CheckoutReservation {
  return {
    disposition: 'RESERVED',
    stripeCustomerId: null,
    selectedOffer: 'STANDARD_INDIVIDUAL',
    checkoutReference: 'checkout_attempt_00000000-0000-4000-8000-0000000002b2',
    ...overrides,
  };
}

function createStore(): CheckoutBillingStore & {
  isSotfEligible: ReturnType<typeof vi.fn>;
  reserve: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  return {
    isSotfEligible: vi.fn().mockResolvedValue(true),
    reserve: vi.fn().mockResolvedValue(reservation()),
    complete: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function createStripeMock() {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_slice_b' }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_slice_b',
          status: 'open',
          url: 'https://checkout.stripe.test/session',
        }),
        retrieve: vi.fn(),
      },
    },
  };
}

describe('Entry billing Checkout authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds the locked Standard Checkout shape entirely from server configuration', () => {
    const params = buildCheckoutSessionParams({
      canonicalUserId,
      stripeCustomerId: 'cus_existing',
      offer: 'STANDARD_INDIVIDUAL',
      attemptId: 'attempt-standard',
      config,
    });

    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_existing',
      client_reference_id: canonicalUserId,
      payment_method_collection: 'always',
      line_items: [
        { price: 'price_setup_199', quantity: 1 },
        { price: 'price_monthly_39', quantity: 1 },
      ],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          canonical_user_id: canonicalUserId,
          commercial_offer: 'STANDARD_INDIVIDUAL',
          checkout_attempt_id: 'attempt-standard',
        },
      },
      metadata: {
        canonical_user_id: canonicalUserId,
        commercial_offer: 'STANDARD_INDIVIDUAL',
        checkout_attempt_id: 'attempt-standard',
      },
    });
    expect(params.discounts).toBeUndefined();
    expect(params.success_url).toBe(
      'https://entry.example.test/account?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    );
    expect(params.cancel_url).toBe('https://entry.example.test/account?checkout=cancelled');
  });

  it('builds the locked SOTF Checkout shape without a setup line', () => {
    const params = buildCheckoutSessionParams({
      canonicalUserId,
      stripeCustomerId: 'cus_existing',
      offer: 'SOTF_FOUNDING_FELLOW',
      attemptId: 'attempt-sotf',
      config,
    });

    expect(params).toMatchObject({
      mode: 'subscription',
      payment_method_collection: 'if_required',
      line_items: [{ price: 'price_monthly_39', quantity: 1 }],
      discounts: [{ coupon: 'coupon_sotf_20' }],
      subscription_data: {
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
      },
    });
    expect(params.line_items).not.toContainEqual({ price: 'price_setup_199', quantity: 1 });
  });

  it('rejects an ineligible SOTF request before reserving or calling Stripe', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    store.isSotfEligible.mockResolvedValue(false);

    await expect(createCheckoutForUser(
      { id: canonicalUserId, email: 'candidate@example.invalid' },
      'SOTF_FOUNDING_FELLOW',
      { stripe: stripe as unknown as Stripe, store, config },
    )).rejects.toMatchObject({ code: 'SOTF_NOT_ELIGIBLE', status: 403 });

    expect(store.reserve).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('reuses the canonical mapped Stripe Customer', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    store.reserve.mockResolvedValue(reservation({ stripeCustomerId: 'cus_existing' }));

    await createCheckoutForUser(
      { id: canonicalUserId, email: 'owner@example.invalid' },
      'STANDARD_INDIVIDUAL',
      {
        stripe: stripe as unknown as Stripe,
        store,
        config,
        createAttemptId: () => '00000000-0000-4000-8000-0000000002b2',
      },
    );

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
      { idempotencyKey: 'lead-emergence-checkout:00000000-0000-4000-8000-0000000002b2' },
    );
  });

  it('uses stable server idempotency and permits only one concurrent Customer creation', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    let reserved = false;
    store.reserve.mockImplementation(async (input) => {
      if (!reserved) {
        reserved = true;
        return reservation({ checkoutReference: input.reservationId });
      }
      return reservation({
        disposition: 'IN_PROGRESS',
        checkoutReference: 'checkout_attempt_other',
      });
    });

    const first = createCheckoutForUser(
      { id: canonicalUserId, email: 'owner@example.invalid' },
      'STANDARD_INDIVIDUAL',
      {
        stripe: stripe as unknown as Stripe,
        store,
        config,
        createAttemptId: () => '00000000-0000-4000-8000-0000000002b2',
      },
    );
    const second = createCheckoutForUser(
      { id: canonicalUserId, email: 'owner@example.invalid' },
      'STANDARD_INDIVIDUAL',
      {
        stripe: stripe as unknown as Stripe,
        store,
        config,
        createAttemptId: () => '00000000-0000-4000-8000-0000000002b3',
      },
    );
    const results = await Promise.allSettled([first, second]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { canonical_user_id: canonicalUserId } }),
      { idempotencyKey: `lead-emergence-customer:${canonicalUserId}` },
    );
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing open Checkout attempt for the same offer', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    store.reserve.mockResolvedValue(reservation({
      disposition: 'EXISTING_SESSION',
      stripeCustomerId: 'cus_existing',
      checkoutReference: 'cs_test_existing',
    }));
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_existing',
      status: 'open',
      url: 'https://checkout.stripe.test/existing',
    });

    await expect(createCheckoutForUser(
      { id: canonicalUserId },
      'STANDARD_INDIVIDUAL',
      { stripe: stripe as unknown as Stripe, store, config },
    )).resolves.toEqual({
      sessionId: 'cs_test_existing',
      url: 'https://checkout.stripe.test/existing',
      reused: true,
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('replaces only a confirmed expired Checkout attempt', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    store.reserve
      .mockResolvedValueOnce(reservation({
        disposition: 'EXISTING_SESSION',
        stripeCustomerId: 'cus_existing',
        checkoutReference: 'cs_test_expired',
      }))
      .mockResolvedValueOnce(reservation({
        stripeCustomerId: 'cus_existing',
        checkoutReference: 'checkout_attempt_00000000-0000-4000-8000-0000000002b2',
      }));
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_expired',
      status: 'expired',
      url: null,
    });

    await createCheckoutForUser(
      { id: canonicalUserId },
      'STANDARD_INDIVIDUAL',
      {
        stripe: stripe as unknown as Stripe,
        store,
        config,
        createAttemptId: () => '00000000-0000-4000-8000-0000000002b2',
      },
    );

    expect(store.reserve).toHaveBeenNthCalledWith(2, expect.objectContaining({
      replaceCheckoutReference: 'cs_test_expired',
    }));
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('never treats a completed Checkout as replaceable payment proof', async () => {
    const store = createStore();
    const stripe = createStripeMock();
    store.reserve.mockResolvedValue(reservation({
      disposition: 'EXISTING_SESSION',
      checkoutReference: 'cs_test_complete',
    }));
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_complete',
      status: 'complete',
      url: null,
    });

    await expect(createCheckoutForUser(
      { id: canonicalUserId },
      'STANDARD_INDIVIDUAL',
      { stripe: stripe as unknown as Stripe, store, config },
    )).rejects.toBeInstanceOf(BillingCheckoutError);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });
});
