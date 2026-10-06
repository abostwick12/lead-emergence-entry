import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('server-only', () => ({}));

import {
  BillingReconciliationError,
  reconcileStripeEvent,
} from '@/lib/billing/reconciliation';
import type { BillingConfig } from '@/lib/billing/config';
import type {
  ApplyReconciliationInput,
  BillingReconciliationContext,
  BillingReconciliationStore,
} from '@/lib/billing/store';

const config: BillingConfig = {
  stripeSecretKey: 'sk_test_slice_c',
  monthlyPriceId: 'price_monthly_39',
  setupPriceId: 'price_setup_199',
  sotfCouponId: 'coupon_sotf_20',
  portalConfigurationId: 'bpc_slice_e',
  entryOrigin: 'https://entry.example.test',
};

const standardContext: BillingReconciliationContext = {
  canonicalUserId: '00000000-0000-4000-8000-0000000002c1',
  selectedOffer: 'STANDARD_INDIVIDUAL',
  stripeCustomerId: 'cus_standard',
  stripeSubscriptionId: 'sub_standard',
  stripeCheckoutSessionId: 'cs_standard',
  setupFeePaidAt: null,
  normalizedState: 'PENDING_CHECKOUT',
  paymentMethodRequired: false,
  graceStartedAt: null,
  graceUntil: null,
  sotfQualifyingPaidCycles: 0,
};

const sotfContext: BillingReconciliationContext = {
  ...standardContext,
  canonicalUserId: '00000000-0000-4000-8000-0000000002c2',
  selectedOffer: 'SOTF_FOUNDING_FELLOW',
  stripeCustomerId: 'cus_sotf',
  stripeSubscriptionId: 'sub_sotf',
  stripeCheckoutSessionId: 'cs_sotf',
};

function subscription(
  context: BillingReconciliationContext,
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  return {
    id: context.stripeSubscriptionId ?? 'sub_new',
    object: 'subscription',
    customer: context.stripeCustomerId,
    status: 'active',
    metadata: {
      canonical_user_id: context.canonicalUserId,
      commercial_offer: context.selectedOffer,
      checkout_attempt_id: 'attempt_slice_c',
    },
    items: {
      data: [{
        id: 'si_slice_c',
        current_period_start: 1_800_000_000,
        current_period_end: 1_802_592_000,
        price: { id: config.monthlyPriceId },
      }],
    },
    discounts: context.selectedOffer === 'SOTF_FOUNDING_FELLOW'
      ? [{ id: 'di_sotf', object: 'discount', source: { type: 'coupon', coupon: config.sotfCouponId } }]
      : [],
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    default_payment_method: 'pm_test',
    default_source: null,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function invoice(
  context: BillingReconciliationContext,
  overrides: Record<string, unknown> = {},
): Stripe.Invoice {
  return {
    id: 'in_slice_c',
    object: 'invoice',
    customer: context.stripeCustomerId,
    status: 'paid',
    currency: 'usd',
    amount_paid: 3900,
    billing_reason: 'subscription_cycle',
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: context.stripeSubscriptionId,
        metadata: null,
      },
    },
    lines: {
      data: [{ pricing: { type: 'price_details', price_details: { price: config.monthlyPriceId } } }],
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function event(type: string, object: object, id = `evt_${type.replaceAll('.', '_')}`): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    created: 1_800_000_100,
    data: { object },
  } as Stripe.Event;
}

function setup(context: BillingReconciliationContext | null) {
  const applied: ApplyReconciliationInput[] = [];
  const store: BillingReconciliationStore = {
    resolveByCustomer: vi.fn().mockResolvedValue(context),
    apply: vi.fn().mockImplementation(async (input: ApplyReconciliationInput) => {
      applied.push(input);
      return {
        applicationResult: input.reconciliationOutcome,
        resultingState: input.normalizedState ?? context?.normalizedState ?? 'PENDING_CHECKOUT',
        effectiveState: input.normalizedState ?? context?.normalizedState ?? 'PENDING_CHECKOUT',
        resultingPaidCycles: context?.sotfQualifyingPaidCycles ?? 0,
      };
    }),
  };
  const stripe = {
    checkout: { sessions: { retrieve: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
    invoices: { retrieve: vi.fn() },
    customers: { retrieve: vi.fn() },
  };
  return { store, stripe, applied };
}

describe('Stripe billing reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'checkout.session.completed', 'checkout.session.expired',
    'customer.subscription.updated', 'invoice.paid',
  ])('retains the verified account for duplicate %s lifecycle retries', async (eventType) => {
    const test = setup(standardContext);
    const sub = subscription(standardContext);
    const session = {
      id: standardContext.stripeCheckoutSessionId,
      customer: standardContext.stripeCustomerId,
      subscription: sub,
      metadata: sub.metadata,
      line_items: { data: [{ price: config.monthlyPriceId }, { price: config.setupPriceId }] },
    };
    test.stripe.checkout.sessions.retrieve.mockResolvedValue(session);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    test.stripe.invoices.retrieve.mockResolvedValue(invoice(standardContext));
    vi.mocked(test.store.apply).mockResolvedValue({
      applicationResult: 'DUPLICATE', resultingState: 'ACTIVE',
      effectiveState: 'ACTIVE', resultingPaidCycles: 0,
    });
    const object = eventType.startsWith('checkout.') ? session
      : eventType.startsWith('customer.') ? sub : invoice(standardContext);
    const result = await reconcileStripeEvent(event(eventType, object), {
      stripe: test.stripe as unknown as Stripe, store: test.store, config,
    });
    expect(result).toMatchObject({
      applicationResult: 'DUPLICATE', canonicalUserId: standardContext.canonicalUserId,
    });
    expect(test.store.apply).toHaveBeenCalledWith(expect.objectContaining({
      canonicalUserId: standardContext.canonicalUserId,
    }));
  });

  it('fails closed for an unknown Stripe Customer', async () => {
    const test = setup(null);
    const sub = subscription(standardContext);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await expect(reconcileStripeEvent(
      event('customer.subscription.updated', sub),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'UNKNOWN_STRIPE_CUSTOMER' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('fails closed when canonical Subscription ownership contradicts Stripe', async () => {
    const context = { ...standardContext, stripeSubscriptionId: 'sub_other' };
    const test = setup(context);
    const sub = subscription({ ...standardContext, stripeSubscriptionId: 'sub_standard' });
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await expect(reconcileStripeEvent(
      event('customer.subscription.updated', sub),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toBeInstanceOf(BillingReconciliationError);
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('binds Checkout completion to current Stripe truth without marking setup paid', async () => {
    const test = setup(standardContext);
    const sub = subscription(standardContext, {
      status: 'trialing',
      trial_start: 1_800_000_000,
      trial_end: 1_801_209_600,
    });
    const session = {
      id: standardContext.stripeCheckoutSessionId,
      customer: standardContext.stripeCustomerId,
      subscription: sub,
      metadata: sub.metadata,
      line_items: { data: [{ price: { id: config.setupPriceId } }, { price: { id: config.monthlyPriceId } }] },
    };
    test.stripe.checkout.sessions.retrieve.mockResolvedValue(session);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('checkout.session.completed', session),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'TRIALING',
      setupFeePaidAt: null,
      stripeCheckoutSessionId: 'cs_standard',
    });
  });

  it('marks a paid Standard initial setup invoice exactly as setup evidence', async () => {
    const test = setup(standardContext);
    const sub = subscription(standardContext, { status: 'trialing' });
    const initial = invoice(standardContext, {
      amount_paid: 19900,
      billing_reason: 'subscription_create',
      lines: { data: [
        { pricing: { price_details: { price: config.setupPriceId } } },
        { pricing: { price_details: { price: config.monthlyPriceId } } },
      ] },
    });
    test.stripe.invoices.retrieve.mockResolvedValue(initial);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', initial),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0].setupFeePaidAt).toBe('2027-01-15T08:01:40.000Z');
    expect(test.applied[0].qualifyingPaidCycle).toBe(false);
  });

  it('normalizes an eligible SOTF Stripe subscription trial as trialing', async () => {
    const test = setup(sotfContext);
    const sub = subscription(sotfContext, {
      status: 'trialing',
      trial_start: 1_800_000_000,
      trial_end: 1_801_209_600,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('customer.subscription.created', sub),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'TRIALING',
      stripeSubscriptionId: 'sub_sotf',
      trialStartedAt: '2027-01-15T08:00:00.000Z',
      trialEndsAt: '2027-01-29T08:00:00.000Z',
    });
  });

  it('excludes a zero-dollar SOTF trial invoice from paid-cycle counting', async () => {
    const test = setup(sotfContext);
    const sub = subscription(sotfContext, { status: 'trialing' });
    const trialInvoice = invoice(sotfContext, {
      amount_paid: 0,
      billing_reason: 'subscription_create',
    });
    test.stripe.invoices.retrieve.mockResolvedValue(trialInvoice);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', trialInvoice),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0].qualifyingPaidCycle).toBe(false);
    expect(test.applied[0].clearGrace).toBe(false);
  });

  it('qualifies only a discounted $19 SOTF recurring paid invoice', async () => {
    const test = setup(sotfContext);
    const sub = subscription(sotfContext);
    const paid = invoice(sotfContext, { amount_paid: 1900 });
    test.stripe.invoices.retrieve.mockResolvedValue(paid);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', paid),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      qualifyingPaidCycle: true,
      clearGrace: true,
      normalizedState: 'ACTIVE',
      invoiceAmountPaid: 1900,
    });
    expect((test.stripe.subscriptions as { update?: unknown }).update).toBeUndefined();
  });

  it('accepts the twelfth $19 SOTF payment while the founding discount remains attached', async () => {
    const context = { ...sotfContext, sotfQualifyingPaidCycles: 11 };
    const test = setup(context);
    const sub = subscription(context);
    const paid = invoice(context, { amount_paid: 1900 });
    test.stripe.invoices.retrieve.mockResolvedValue(paid);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', paid),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      qualifyingPaidCycle: true,
      invoiceAmountPaid: 1900,
      normalizedState: 'ACTIVE',
    });
  });

  it('accepts a normal $39 thirteenth SOTF cycle without recreating the discount', async () => {
    const context = { ...sotfContext, sotfQualifyingPaidCycles: 12 };
    const test = setup(context);
    const sub = subscription(context, { discounts: [] });
    const paid = invoice(context, { amount_paid: 3900 });
    test.stripe.invoices.retrieve.mockResolvedValue(paid);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', paid),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0].qualifyingPaidCycle).toBe(false);
    expect((test.stripe.subscriptions as { update?: unknown }).update).toBeUndefined();
  });

  it('fails closed on an unexpected discount after the founding period', async () => {
    const context = { ...sotfContext, sotfQualifyingPaidCycles: 12 };
    const test = setup(context);
    const sub = subscription(context, {
      discounts: [{ id: 'di_other', object: 'discount', source: { type: 'coupon', coupon: 'coupon_other' } }],
    });
    const paid = invoice(context, { amount_paid: 3900 });
    test.stripe.invoices.retrieve.mockResolvedValue(paid);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await expect(reconcileStripeEvent(
      event('invoice.paid', paid),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('starts grace only for a renewal failure with established paid history', async () => {
    const context = { ...standardContext, setupFeePaidAt: '2027-01-01T00:00:00Z', normalizedState: 'ACTIVE' as const };
    const test = setup(context);
    const sub = subscription(context, { status: 'past_due' });
    const failed = invoice(context, { status: 'open', amount_paid: 0 });
    test.stripe.invoices.retrieve.mockResolvedValue(failed);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.payment_failed', failed),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      startGraceAt: '2027-01-15T08:01:40.000Z',
      normalizedState: 'PAYMENT_GRACE',
      qualifyingPaidCycle: false,
    });
  });

  it('clears grace and restores active state after a valid Standard recurring payment', async () => {
    const context = {
      ...standardContext,
      setupFeePaidAt: '2027-01-01T00:00:00Z',
      normalizedState: 'PAYMENT_GRACE' as const,
      graceStartedAt: '2027-01-10T00:00:00Z',
      graceUntil: '2027-01-17T00:00:00Z',
    };
    const test = setup(context);
    const sub = subscription(context, { status: 'active' });
    const recovered = invoice(context, { status: 'paid', amount_paid: 3900 });
    test.stripe.invoices.retrieve.mockResolvedValue(recovered);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.paid', recovered),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'ACTIVE',
      clearGrace: true,
      paymentMethodRequired: false,
      qualifyingPaidCycle: false,
    });
  });

  it('does not manufacture grace for a first failed charge after a no-card trial', async () => {
    const test = setup(sotfContext);
    const sub = subscription(sotfContext, { status: 'past_due' });
    const failed = invoice(sotfContext, { status: 'open', amount_paid: 0 });
    test.stripe.invoices.retrieve.mockResolvedValue(failed);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.payment_failed', failed),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0].startGraceAt).toBeNull();
    expect(test.applied[0].normalizedState).toBe('SUSPENDED_PAYMENT');
  });

  it.each(
    (['TRIALING', 'ACTIVE'] as const).flatMap((prior) =>
      ['past_due', 'unpaid'].flatMap((status) =>
        ['invoice.payment_failed', 'customer.subscription.updated'].flatMap((eventType) =>
          [false, true].map((cancelAtPeriodEnd) => ({ prior, status, eventType, cancelAtPeriodEnd })),
        ),
      ),
    ),
  )('suspends $prior without paid history on $status/$eventType/cancel=$cancelAtPeriodEnd', async ({ prior, status, eventType, cancelAtPeriodEnd }) => {
    const context = { ...sotfContext, normalizedState: prior };
    const test = setup(context);
    const sub = subscription(context, { status, cancel_at_period_end: cancelAtPeriodEnd });
    const failed = invoice(context, { status: 'open', amount_paid: 0 });
    test.stripe.invoices.retrieve.mockResolvedValue(failed);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);

    await reconcileStripeEvent(
      event(eventType, eventType === 'invoice.payment_failed' ? failed : sub),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );

    expect(test.applied).toHaveLength(1);
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'SUSPENDED_PAYMENT',
      startGraceAt: null,
      qualifyingPaidCycle: false,
      clearGrace: false,
    });
  });

  it.each([
    { label: 'paid setup', context: { ...standardContext, normalizedState: 'ACTIVE' as const, setupFeePaidAt: '2027-01-01T00:00:00Z' } },
    { label: 'paid SOTF cycle', context: { ...sotfContext, normalizedState: 'ACTIVE' as const, sotfQualifyingPaidCycles: 1 } },
    { label: 'existing grace', context: { ...sotfContext, normalizedState: 'PAYMENT_GRACE' as const } },
  ].flatMap((item) => ['past_due', 'unpaid'].map((status) => ({ ...item, status }))))(
    'preserves $label state on a $status subscription update', async ({ context, status }) => {
      const test = setup(context);
      const sub = subscription(context, { status });
      test.stripe.subscriptions.retrieve.mockResolvedValue(sub);

      await reconcileStripeEvent(
        event('customer.subscription.updated', sub),
        { stripe: test.stripe as unknown as Stripe, store: test.store, config },
      );

      expect(test.applied[0]).toMatchObject({
        normalizedState: context.normalizedState,
        startGraceAt: null,
        qualifyingPaidCycle: false,
        clearGrace: false,
      });
    },
  );

  it('records payment action required without incrementing paid cycles or granting access', async () => {
    const context = { ...standardContext, normalizedState: 'PAYMENT_GRACE' as const };
    const test = setup(context);
    const sub = subscription(context, { status: 'past_due' });
    const actionRequired = invoice(context, { status: 'open', amount_paid: 0 });
    test.stripe.invoices.retrieve.mockResolvedValue(actionRequired);
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('invoice.payment_action_required', actionRequired),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'PAYMENT_GRACE',
      paymentMethodRequired: true,
      qualifyingPaidCycle: false,
      clearGrace: false,
    });
  });

  it('uses current subscription state for an out-of-order resume event', async () => {
    const context = { ...sotfContext, normalizedState: 'PAUSED_NO_PAYMENT_METHOD' as const };
    const test = setup(context);
    const staleEventObject = subscription(context, { status: 'paused' });
    const current = subscription(context, { status: 'active' });
    test.stripe.subscriptions.retrieve.mockResolvedValue(current);
    await reconcileStripeEvent(
      event('customer.subscription.resumed', staleEventObject),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0].normalizedState).toBe('ACTIVE');
    expect(test.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      'sub_sotf',
      { expand: ['discounts', 'customer'] },
    );
  });

  it('normalizes classic period-end cancellation from cancel_at_period_end', async () => {
    const test = setup(standardContext);
    const scheduled = subscription(standardContext, { cancel_at_period_end: true });
    test.stripe.subscriptions.retrieve.mockResolvedValue(scheduled);
    await reconcileStripeEvent(
      event('customer.subscription.updated', scheduled),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'CANCEL_AT_PERIOD_END',
      cancelAtPeriodEnd: true,
    });
  });

  it('normalizes exact flexible period-end cancellation and retains its boundary', async () => {
    const test = setup(standardContext);
    const scheduled = subscription(standardContext, {
      billing_mode: { type: 'flexible', updated_at: 1_800_000_000 },
      cancel_at: 1_802_592_000,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(scheduled);
    await reconcileStripeEvent(
      event('customer.subscription.updated', scheduled),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'CANCEL_AT_PERIOD_END',
      cancelAtPeriodEnd: true,
      currentPeriodEndsAt: '2027-02-14T08:00:00.000Z',
    });
  });

  it.each([
    ['before', 1_802_591_999],
    ['after', 1_802_592_001],
  ])('does not treat flexible cancel_at %s the period end as ordinary period-end cancellation', async (_label, cancelAt) => {
    const test = setup(standardContext);
    const customCancellation = subscription(standardContext, {
      billing_mode: { type: 'flexible', updated_at: 1_800_000_000 },
      cancel_at: cancelAt,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(customCancellation);
    await reconcileStripeEvent(
      event('customer.subscription.updated', customCancellation),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });
  });

  it('does not treat an expired flexible period boundary as a scheduled cancellation', async () => {
    const periodEnd = Math.floor(Date.now() / 1000) - 1;
    const test = setup(standardContext);
    const expiredCancellation = subscription(standardContext, {
      billing_mode: { type: 'flexible', updated_at: periodEnd - 60 },
      cancel_at: periodEnd,
      items: {
        data: [{
          id: 'si_slice_c',
          current_period_start: periodEnd - 2_592_000,
          current_period_end: periodEnd,
          price: { id: config.monthlyPriceId },
        }],
      },
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(expiredCancellation);
    await reconcileStripeEvent(
      event('customer.subscription.updated', expiredCancellation),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });
  });

  it('preserves normal active behavior without a cancellation signal', async () => {
    const test = setup(standardContext);
    const active = subscription(standardContext, {
      billing_mode: { type: 'flexible', updated_at: 1_800_000_000 },
      cancel_at: null,
      cancel_at_period_end: false,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(active);
    await reconcileStripeEvent(
      event('customer.subscription.updated', active),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });
  });

  it('accepts terminal SOTF deletion with the expected founding discount', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled' });
    await reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'CANCELED',
      cancelAtPeriodEnd: false,
    });
  });

  it('accepts terminal SOTF deletion when Stripe has removed the founding discount', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', discounts: [] });
    await reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'CANCELED',
      cancelAtPeriodEnd: false,
    });
  });

  it('resolves a terminal SOTF Discount ID to the expected founding coupon', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', discounts: ['di_expected'] });
    const resolved = subscription(sotfContext, {
      status: 'canceled',
      discounts: [{
        id: 'di_expected',
        object: 'discount',
        source: { type: 'coupon', coupon: config.sotfCouponId },
      }],
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(resolved);
    await reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      'sub_sotf',
      { expand: ['discounts', 'customer'] },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'CANCELED',
      cancelAtPeriodEnd: false,
    });
  });

  it('fails closed when a terminal SOTF Discount ID resolves to a different coupon', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', discounts: ['di_wrong'] });
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription(sotfContext, {
      status: 'canceled',
      discounts: [{
        id: 'di_wrong',
        object: 'discount',
        source: { type: 'coupon', coupon: 'coupon_other' },
      }],
    }));
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('fails closed when a terminal SOTF Discount ID cannot be resolved', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', discounts: ['di_missing'] });
    test.stripe.subscriptions.retrieve.mockRejectedValue(new Error('missing'));
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('fails closed on multiple terminal SOTF discounts without attempting resolution', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, {
      status: 'canceled',
      discounts: ['di_expected', 'di_other'],
    });
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected discount in terminal SOTF deletion', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, {
      status: 'canceled',
      discounts: [{ id: 'di_other', object: 'discount', source: { type: 'coupon', coupon: 'coupon_other' } }],
    });
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('rejects terminal SOTF deletion for the wrong Customer', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', customer: 'cus_other' });
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SUBSCRIPTION_CUSTOMER_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('rejects terminal SOTF deletion for the wrong Subscription', async () => {
    const test = setup(sotfContext);
    const deleted = subscription(sotfContext, { status: 'canceled', id: 'sub_other' });
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SUBSCRIPTION_OWNERSHIP_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('rejects a deleted event whose subscription object is not terminal', async () => {
    const test = setup(sotfContext);
    const nonterminal = subscription(sotfContext, { status: 'active', discounts: [] });
    await expect(reconcileStripeEvent(
      event('customer.subscription.deleted', nonterminal),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SUBSCRIPTION_TERMINAL_STATE_REQUIRED' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('still rejects non-terminal ACTIVE SOTF without the required founding discount', async () => {
    const test = setup(sotfContext);
    const active = subscription(sotfContext, { status: 'active', discounts: [] });
    test.stripe.subscriptions.retrieve.mockResolvedValue(active);
    await expect(reconcileStripeEvent(
      event('customer.subscription.updated', active),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('still rejects non-terminal ACTIVE SOTF with an unexpanded Discount ID', async () => {
    const test = setup(sotfContext);
    const active = subscription(sotfContext, { status: 'active', discounts: ['di_expected'] });
    test.stripe.subscriptions.retrieve.mockResolvedValue(active);
    await expect(reconcileStripeEvent(
      event('customer.subscription.updated', active),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('still rejects scheduled SOTF cancellation without the required founding discount', async () => {
    const test = setup(sotfContext);
    const scheduled = subscription(sotfContext, {
      status: 'active',
      discounts: [],
      cancel_at_period_end: true,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(scheduled);
    await expect(reconcileStripeEvent(
      event('customer.subscription.updated', scheduled),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    )).rejects.toMatchObject({ code: 'SOTF_DISCOUNT_MISMATCH' });
    expect(test.store.apply).not.toHaveBeenCalled();
  });

  it('normalizes pause, cancellation scheduling, and deletion without deleting identity', async () => {
    const pauseTest = setup(sotfContext);
    pauseTest.stripe.subscriptions.retrieve.mockResolvedValue(subscription(sotfContext, { status: 'paused' }));
    await reconcileStripeEvent(
      event('customer.subscription.paused', subscription(sotfContext)),
      { stripe: pauseTest.stripe as unknown as Stripe, store: pauseTest.store, config },
    );
    expect(pauseTest.applied[0].normalizedState).toBe('PAUSED_NO_PAYMENT_METHOD');

    const cancelTest = setup(standardContext);
    cancelTest.stripe.subscriptions.retrieve.mockResolvedValue(subscription(standardContext, { cancel_at_period_end: true }));
    await reconcileStripeEvent(
      event('customer.subscription.updated', subscription(standardContext)),
      { stripe: cancelTest.stripe as unknown as Stripe, store: cancelTest.store, config },
    );
    expect(cancelTest.applied[0].normalizedState).toBe('CANCEL_AT_PERIOD_END');

    const deletedTest = setup(standardContext);
    const deleted = subscription(standardContext, { status: 'canceled' });
    await reconcileStripeEvent(
      event('customer.subscription.deleted', deleted),
      { stripe: deletedTest.stripe as unknown as Stripe, store: deletedTest.store, config },
    );
    expect(deletedTest.applied[0].normalizedState).toBe('CANCELED');
  });

  it('records payment-method action without creating a new billing state', async () => {
    const test = setup(sotfContext);
    const sub = subscription(sotfContext, {
      status: 'trialing',
      customer: {
        id: sotfContext.stripeCustomerId,
        invoice_settings: { default_payment_method: null },
        default_source: null,
      },
      default_payment_method: null,
      default_source: null,
    });
    test.stripe.subscriptions.retrieve.mockResolvedValue(sub);
    await reconcileStripeEvent(
      event('customer.subscription.trial_will_end', sub),
      { stripe: test.stripe as unknown as Stripe, store: test.store, config },
    );
    expect(test.applied[0]).toMatchObject({
      normalizedState: 'TRIALING',
      paymentMethodRequired: true,
    });
  });
});
