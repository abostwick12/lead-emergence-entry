import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('server-only', () => ({}));

import {
  BillingLifecycleError,
  createPortalSessionForUser,
  drainPendingSotfDiscountRemovals,
  resumeSotfSubscriptionForUser,
} from '@/lib/billing/lifecycle';
import type { BillingConfig } from '@/lib/billing/config';
import type {
  BillingLifecycleContext,
  BillingLifecycleStore,
  SotfDiscountRemovalCandidate,
} from '@/lib/billing/store';

const config: BillingConfig = {
  stripeSecretKey: 'sk_test_slice_e',
  monthlyPriceId: 'price_monthly_39',
  setupPriceId: 'price_setup_199',
  sotfCouponId: 'coupon_sotf_20',
  portalConfigurationId: 'bpc_slice_e',
  entryOrigin: 'https://entry.example.test',
};

const context: BillingLifecycleContext = {
  canonicalUserId: '00000000-0000-4000-8000-0000000000e1',
  selectedOffer: 'SOTF_FOUNDING_FELLOW',
  stripeCustomerId: 'cus_slice_e',
  stripeSubscriptionId: 'sub_slice_e',
  normalizedState: 'PAUSED_NO_PAYMENT_METHOD',
  paymentMethodRequired: true,
  graceUntil: null,
  sotfQualifyingPaidCycles: 0,
  discountRemovalDue: false,
  discountRemovedAt: null,
};

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_slice_e',
    object: 'subscription',
    customer: {
      id: 'cus_slice_e',
      object: 'customer',
      invoice_settings: { default_payment_method: 'pm_slice_e' },
      default_source: null,
    },
    status: 'paused',
    collection_method: 'charge_automatically',
    metadata: {
      canonical_user_id: context.canonicalUserId,
      commercial_offer: 'SOTF_FOUNDING_FELLOW',
    },
    items: { data: [{ price: { id: config.monthlyPriceId } }] },
    discounts: [{
      id: 'di_slice_e',
      object: 'discount',
      source: { type: 'coupon', coupon: config.sotfCouponId },
    }],
    default_payment_method: null,
    default_source: null,
    latest_invoice: 'in_trial',
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function discount(overrides: Record<string, unknown> = {}): Stripe.Discount {
  return {
    id: 'di_slice_e',
    object: 'discount',
    source: { type: 'coupon', coupon: config.sotfCouponId },
    ...overrides,
  } as unknown as Stripe.Discount;
}

function invoiceLine(overrides: Record<string, unknown> = {}): Stripe.InvoiceLineItem {
  return {
    id: 'il_resume',
    object: 'line_item',
    amount: 3900,
    subtotal: 3900,
    currency: 'usd',
    quantity: 1,
    discounts: [],
    discount_amounts: [{ amount: 2000, discount: 'di_slice_e' }],
    parent: {
      type: 'subscription_item_details',
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        proration_details: null,
        subscription: context.stripeSubscriptionId,
        subscription_item: 'si_slice_e',
      },
    },
    pricing: {
      type: 'price_details',
      price_details: { price: config.monthlyPriceId, product: 'prod_slice_e' },
      unit_amount_decimal: '3900',
    },
    taxes: [],
    ...overrides,
  } as unknown as Stripe.InvoiceLineItem;
}

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  const foundingDiscount = discount();
  return {
    id: 'in_resume',
    object: 'invoice',
    customer: context.stripeCustomerId,
    status: 'open',
    collection_method: 'charge_automatically',
    currency: 'usd',
    billing_reason: 'subscription_cycle',
    amount_due: 1900,
    amount_paid: 0,
    amount_remaining: 1900,
    attempted: false,
    subtotal: 3900,
    subtotal_excluding_tax: 3900,
    total: 1900,
    total_excluding_tax: 1900,
    amount_shipping: 0,
    starting_balance: 0,
    pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 0,
    total_taxes: [],
    discounts: [foundingDiscount],
    total_discount_amounts: [{ amount: 2000, discount: foundingDiscount }],
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: context.stripeSubscriptionId,
        metadata: {
          canonical_user_id: context.canonicalUserId,
          commercial_offer: 'SOTF_FOUNDING_FELLOW',
        },
      },
    },
    lines: {
      object: 'list',
      data: [invoiceLine()],
      has_more: false,
      url: '/v1/invoices/in_resume/lines',
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function paidInvoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return invoice({
    status: 'paid',
    attempted: true,
    amount_paid: 1900,
    amount_remaining: 0,
    ...overrides,
  });
}

function setup() {
  const store: BillingLifecycleStore = {
    resolveByCanonicalUser: vi.fn().mockResolvedValue(context),
    listPendingDiscountRemovals: vi.fn().mockResolvedValue([]),
    recordDiscountRemovalAttempt: vi.fn().mockResolvedValue(undefined),
  };
  const stripe = {
    billingPortal: {
      configurations: { retrieve: vi.fn().mockResolvedValue({
        id: 'bpc_slice_e',
        active: true,
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: {
            enabled: true,
            mode: 'at_period_end',
            proration_behavior: 'none',
          },
          subscription_update: { enabled: false },
          customer_update: { enabled: false },
        },
      }) },
      sessions: { create: vi.fn() },
    },
    subscriptions: {
      retrieve: vi.fn(),
      resume: vi.fn(),
      update: vi.fn(),
    },
    invoices: {
      retrieve: vi.fn(),
      pay: vi.fn(),
    },
    customers: { retrieve: vi.fn() },
  };
  return { store, stripe };
}

function configureValidResume(test: ReturnType<typeof setup>) {
  test.stripe.subscriptions.retrieve.mockResolvedValue(subscription());
  test.stripe.subscriptions.resume.mockResolvedValue(subscription({
    latest_invoice: 'in_resume',
  }));
  test.stripe.invoices.retrieve.mockResolvedValue(invoice());
  test.stripe.invoices.pay.mockResolvedValue(paidInvoice());
}

describe('Entry billing customer lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a Portal session from canonical ownership and fixed Entry configuration', async () => {
    const test = setup();
    test.stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/session' });
    const result = await createPortalSessionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result.url).toBe('https://billing.stripe.test/session');
    expect(test.store.resolveByCanonicalUser).toHaveBeenCalledWith(context.canonicalUserId);
    expect(test.stripe.billingPortal.configurations.retrieve).toHaveBeenCalledWith('bpc_slice_e');
    expect(test.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_slice_e',
      configuration: 'bpc_slice_e',
      return_url: 'https://entry.example.test/account?billing=portal-return',
    });
  });

  it('fails closed when Portal policy would allow plan or quantity changes', async () => {
    const test = setup();
    test.stripe.billingPortal.configurations.retrieve.mockResolvedValue({
      active: true,
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
        subscription_update: { enabled: true, default_allowed_updates: ['price', 'quantity'] },
        customer_update: { enabled: false },
      },
    });
    await expect(createPortalSessionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'PORTAL_CONFIGURATION_POLICY_MISMATCH' });
    expect(test.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('does not change grace, access, or cancellation state from Portal activity', async () => {
    const test = setup();
    const graceContext: BillingLifecycleContext = {
      ...context,
      normalizedState: 'PAYMENT_GRACE',
      graceUntil: '2027-02-01T00:00:00.000Z',
    };
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue(graceContext);
    test.stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/session' });
    await createPortalSessionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(graceContext).toMatchObject({
      normalizedState: 'PAYMENT_GRACE',
      graceUntil: '2027-02-01T00:00:00.000Z',
    });
    expect(test.store.recordDiscountRemovalAttempt).not.toHaveBeenCalled();
  });

  it('does not create a Stripe Customer for a sponsored-only identity', async () => {
    const test = setup();
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue(null);
    await expect(createPortalSessionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'BILLING_RELATIONSHIP_REQUIRED' });
    expect(test.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a paused SOTF resume when no usable payment method exists', async () => {
    const test = setup();
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({
      customer: {
        id: 'cus_slice_e',
        object: 'customer',
        invoice_settings: { default_payment_method: null },
        default_source: null,
      },
    }));
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'USABLE_PAYMENT_METHOD_REQUIRED' });
    expect(test.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  it('fails closed when Stripe subscription ownership contradicts Entry', async () => {
    const test = setup();
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({ customer: 'cus_other' }));
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toBeInstanceOf(BillingLifecycleError);
    expect(test.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  it('does not apply SOTF resume logic to a Standard subscription', async () => {
    const test = setup();
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue({
      ...context,
      selectedOffer: 'STANDARD_INDIVIDUAL',
    });
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'SOTF_PAUSED_SUBSCRIPTION_REQUIRED' });
    expect(test.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(test.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  it('rejects a paused SOTF subscription that is not configured to charge automatically', async () => {
    const test = setup();
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({
      collection_method: 'send_invoice',
    }));
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'SUBSCRIPTION_COLLECTION_METHOD_MISMATCH' });
    expect(test.stripe.subscriptions.resume).not.toHaveBeenCalled();
  });

  it('uses only GA resume parameters, validates the exact latest invoice, and pays it idempotently', async () => {
    const test = setup();
    const pausedContext = { ...context };
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue(pausedContext);
    configureValidResume(test);

    const result = await resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });

    expect(result.disposition).toBe('RESUME_REQUESTED');
    expect(test.stripe.subscriptions.resume).toHaveBeenCalledTimes(1);
    expect(test.stripe.subscriptions.resume).toHaveBeenCalledWith(
      'sub_slice_e',
      {
        billing_cycle_anchor: 'now',
        proration_behavior: 'none',
      },
      { idempotencyKey: `resume-sotf-${context.canonicalUserId}-sub_slice_e` },
    );
    expect(JSON.stringify(test.stripe.subscriptions.resume.mock.calls[0][1]))
      .not.toContain('payment_behavior');
    expect(test.stripe.invoices.retrieve).toHaveBeenCalledWith(
      'in_resume',
      { expand: ['discounts'] },
    );
    expect(test.stripe.invoices.pay).toHaveBeenCalledWith(
      'in_resume',
      { expand: ['discounts'] },
      {
        idempotencyKey:
          `pay-sotf-resumption-${context.canonicalUserId}-sub_slice_e-in_resume`,
      },
    );
    expect(pausedContext).toMatchObject({
      normalizedState: 'PAUSED_NO_PAYMENT_METHOD',
      sotfQualifyingPaidCycles: 0,
      graceUntil: null,
    });
    expect(test.store.recordDiscountRemovalAttempt).not.toHaveBeenCalled();
  });

  it('fails closed when GA resume does not return the exact latest invoice relationship', async () => {
    const test = setup();
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    test.stripe.subscriptions.resume.mockResolvedValue(subscription({ latest_invoice: null }));
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'RESUMPTION_INVOICE_REQUIRED' });
    expect(test.stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(test.stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong customer', invoice({ customer: 'cus_other' }), 'RESUMPTION_INVOICE_OWNERSHIP_MISMATCH'],
    ['wrong subscription relationship', invoice({
      parent: {
        type: 'subscription_details',
        quote_details: null,
        subscription_details: {
          subscription: 'sub_other',
          metadata: {
            canonical_user_id: context.canonicalUserId,
            commercial_offer: 'SOTF_FOUNDING_FELLOW',
          },
        },
      },
    }), 'RESUMPTION_INVOICE_RELATIONSHIP_MISMATCH'],
    ['wrong amount', invoice({ amount_due: 2000 }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['unexpected recurring price', invoice({
      lines: {
        object: 'list',
        data: [invoiceLine({
          pricing: {
            type: 'price_details',
            price_details: { price: 'price_other', product: 'prod_other' },
            unit_amount_decimal: '3900',
          },
        })],
        has_more: false,
        url: '/v1/invoices/in_resume/lines',
      },
    }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['missing founding discount', invoice({
      discounts: [],
      total_discount_amounts: [],
    }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['wrong founding coupon', invoice({
      discounts: [discount({
        source: { type: 'coupon', coupon: 'coupon_other' },
      })],
    }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['setup price present', invoice({
      lines: {
        object: 'list',
        data: [invoiceLine({
          pricing: {
            type: 'price_details',
            price_details: { price: config.setupPriceId, product: 'prod_setup' },
            unit_amount_decimal: '19900',
          },
        })],
        has_more: false,
        url: '/v1/invoices/in_resume/lines',
      },
    }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['additional charge', invoice({
      lines: {
        object: 'list',
        data: [invoiceLine(), invoiceLine({ id: 'il_extra' })],
        has_more: false,
        url: '/v1/invoices/in_resume/lines',
      },
    }), 'RESUMPTION_INVOICE_CONTRACT_MISMATCH'],
    ['non-payable status', invoice({ status: 'void' }), 'RESUMPTION_INVOICE_NOT_PAYABLE'],
  ])('refuses to pay a resumption invoice with %s', async (_caseName, invalidInvoice, code) => {
    const test = setup();
    configureValidResume(test);
    test.stripe.invoices.retrieve.mockResolvedValue(invalidInvoice);
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code });
    expect(test.stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it('reports a failed exact-invoice payment without granting local state', async () => {
    const test = setup();
    const pausedContext = { ...context };
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue(pausedContext);
    configureValidResume(test);
    test.stripe.invoices.pay.mockRejectedValue(new Error('card declined'));
    await expect(resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    })).rejects.toMatchObject({ code: 'SOTF_RESUMPTION_PAYMENT_FAILED', status: 402 });
    expect(pausedContext).toMatchObject({
      normalizedState: 'PAUSED_NO_PAYMENT_METHOD',
      sotfQualifyingPaidCycles: 0,
      graceUntil: null,
    });
    expect(test.store.recordDiscountRemovalAttempt).not.toHaveBeenCalled();
  });

  it('converges without another payment when the exact resumption invoice is already paid', async () => {
    const test = setup();
    configureValidResume(test);
    test.stripe.invoices.retrieve.mockResolvedValue(paidInvoice());
    const result = await resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result.disposition).toBe('ALREADY_RESUMED');
    expect(test.stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it('treats an already-resumed Stripe subscription idempotently without another mutation', async () => {
    const test = setup();
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active' }));
    const result = await resumeSotfSubscriptionForUser(context.canonicalUserId, {
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result.disposition).toBe('ALREADY_RESUMED');
    expect(test.stripe.subscriptions.resume).not.toHaveBeenCalled();
    expect(test.stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing account', row: null },
    { name: 'different account', row: { ...context, canonicalUserId: '00000000-0000-4000-8000-0000000000e2' } },
  ])('rejects a $name in account-scoped removal without Stripe writes', async ({ row }) => {
    const test = setup();
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue(row);
    await expect(drainPendingSotfDiscountRemovals({
      stripe: test.stripe as unknown as Stripe, store: test.store, config,
      canonicalUserId: context.canonicalUserId,
    })).rejects.toMatchObject({ code: 'DISCOUNT_REMOVAL_OWNERSHIP_MISMATCH' });
    expect(test.store.listPendingDiscountRemovals).not.toHaveBeenCalled();
    expect(test.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(test.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(test.store.recordDiscountRemovalAttempt).not.toHaveBeenCalled();
  });

  it('does not repeat a completed removal on a duplicate account event', async () => {
    const test = setup();
    vi.mocked(test.store.resolveByCanonicalUser).mockResolvedValue({
      ...context, sotfQualifyingPaidCycles: 12, discountRemovalDue: true,
      discountRemovedAt: '2026-10-01T00:00:00Z',
    });
    const result = await drainPendingSotfDiscountRemovals({
      stripe: test.stripe as unknown as Stripe, store: test.store, config,
      canonicalUserId: context.canonicalUserId,
    });
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0, errorCodes: [] });
    expect(test.store.listPendingDiscountRemovals).not.toHaveBeenCalled();
    expect(test.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(test.store.recordDiscountRemovalAttempt).not.toHaveBeenCalled();
  });

  it('removes only the expected founding discount after paid cycle 12 without proration', async () => {
    const test = setup();
    const candidate: SotfDiscountRemovalCandidate = {
      canonicalUserId: context.canonicalUserId,
      stripeCustomerId: 'cus_slice_e',
      stripeSubscriptionId: 'sub_slice_e',
      sotfQualifyingPaidCycles: 12,
      discountRemovalAttemptCount: 0,
    };
    vi.mocked(test.store.listPendingDiscountRemovals).mockResolvedValue([candidate]);
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'active' }));
    test.stripe.subscriptions.update.mockResolvedValue(subscription({ status: 'active', discounts: [] }));
    const result = await drainPendingSotfDiscountRemovals({
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(test.stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_slice_e',
      { discounts: '', proration_behavior: 'none' },
      { idempotencyKey: `remove-sotf-discount-${context.canonicalUserId}` },
    );
    expect(test.store.recordDiscountRemovalAttempt).toHaveBeenCalledWith({
      canonicalUserId: context.canonicalUserId,
      succeeded: true,
      errorCode: null,
    });
  });

  it('converges successfully when the founding discount is already absent', async () => {
    const test = setup();
    vi.mocked(test.store.listPendingDiscountRemovals).mockResolvedValue([{
      canonicalUserId: context.canonicalUserId,
      stripeCustomerId: 'cus_slice_e',
      stripeSubscriptionId: 'sub_slice_e',
      sotfQualifyingPaidCycles: 12,
      discountRemovalAttemptCount: 1,
    }]);
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({ discounts: [] }));
    const result = await drainPendingSotfDiscountRemovals({
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result.failed).toBe(0);
    expect(test.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(test.store.recordDiscountRemovalAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: true }),
    );
  });

  it('fails closed and retains retry evidence for an unexpected discount', async () => {
    const test = setup();
    vi.mocked(test.store.listPendingDiscountRemovals).mockResolvedValue([{
      canonicalUserId: context.canonicalUserId,
      stripeCustomerId: 'cus_slice_e',
      stripeSubscriptionId: 'sub_slice_e',
      sotfQualifyingPaidCycles: 12,
      discountRemovalAttemptCount: 0,
    }]);
    test.stripe.subscriptions.retrieve.mockResolvedValue(subscription({
      discounts: [{ id: 'di_other', object: 'discount', source: { type: 'coupon', coupon: 'coupon_other' } }],
    }));
    const result = await drainPendingSotfDiscountRemovals({
      stripe: test.stripe as unknown as Stripe,
      store: test.store,
      config,
    });
    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(result.errorCodes).toEqual(['UNEXPECTED_SUBSCRIPTION_DISCOUNT']);
    expect(test.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(test.store.recordDiscountRemovalAttempt).toHaveBeenCalledWith({
      canonicalUserId: context.canonicalUserId,
      succeeded: false,
      errorCode: 'UNEXPECTED_SUBSCRIPTION_DISCOUNT',
    });
  });
});
