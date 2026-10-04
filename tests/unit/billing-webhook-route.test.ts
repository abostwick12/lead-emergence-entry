import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingReconciliationContext } from '@/lib/billing/store';

const mocks = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
  getStripeClient: vi.fn(),
  getBillingConfig: vi.fn(),
  getStripeWebhookSecret: vi.fn(),
  createStore: vi.fn(),
  createLifecycleStore: vi.fn(),
  reconcileStripeEvent: vi.fn(),
  drainDiscountRemovals: vi.fn(),
  drainProjectionOutbox: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/billing/stripe', () => ({ getStripeClient: mocks.getStripeClient }));
vi.mock('@/lib/billing/config', () => ({
  getBillingConfig: mocks.getBillingConfig,
  getStripeWebhookSecret: mocks.getStripeWebhookSecret,
}));
vi.mock('@/lib/billing/store', () => ({
  createEntryBillingReconciliationStore: mocks.createStore,
  createEntryBillingLifecycleStore: mocks.createLifecycleStore,
}));
vi.mock('@/lib/billing/reconciliation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/billing/reconciliation')>();
  return { ...original, reconcileStripeEvent: mocks.reconcileStripeEvent };
});
vi.mock('@/lib/billing/lifecycle', () => ({
  drainPendingSotfDiscountRemovals: mocks.drainDiscountRemovals,
}));
vi.mock('@/lib/billing/projection', () => ({
  drainConfiguredPersonalProjectionOutbox: mocks.drainProjectionOutbox,
}));

import { POST } from '@/app/api/billing/stripe/webhook/route';

function request(signature?: string) {
  return new Request('https://entry.example.test/api/billing/stripe/webhook', {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body: '{"signed":"raw-body"}',
  });
}

describe('POST /api/billing/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStripeClient.mockReturnValue({
      webhooks: { constructEventAsync: mocks.constructEventAsync },
    });
    mocks.getStripeWebhookSecret.mockReturnValue('whsec_test');
    mocks.getBillingConfig.mockReturnValue({ kind: 'config' });
    mocks.createStore.mockReturnValue({ kind: 'store' });
    mocks.createLifecycleStore.mockReturnValue({ kind: 'lifecycle-store' });
    mocks.constructEventAsync.mockResolvedValue({ id: 'evt_valid', type: 'invoice.paid' });
    mocks.reconcileStripeEvent.mockResolvedValue({ applicationResult: 'APPLIED' });
    mocks.drainDiscountRemovals.mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      errorCodes: [],
    });
    mocks.drainProjectionOutbox.mockResolvedValue({ attempted: 0, delivered: 0, failed: 0 });
  });

  it('rejects a missing Stripe signature before reconciliation', async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.constructEventAsync).not.toHaveBeenCalled();
    expect(mocks.reconcileStripeEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid Stripe signature', async () => {
    mocks.constructEventAsync.mockRejectedValue(new Error('bad signature'));
    const response = await POST(request('t=1,v1=invalid'));
    expect(response.status).toBe(400);
    expect(mocks.reconcileStripeEvent).not.toHaveBeenCalled();
  });

  it('verifies the exact raw body before accepting a valid event', async () => {
    const response = await POST(request('t=1,v1=valid'));
    expect(response.status).toBe(200);
    expect(mocks.constructEventAsync).toHaveBeenCalledWith(
      '{"signed":"raw-body"}',
      't=1,v1=valid',
      'whsec_test',
    );
    expect(mocks.reconcileStripeEvent).toHaveBeenCalledTimes(1);
    expect(mocks.drainDiscountRemovals).toHaveBeenCalledTimes(1);
    expect(mocks.drainProjectionOutbox).toHaveBeenCalledTimes(1);
  });

  it('retains canonical reconciliation but requests a retry when discount removal fails', async () => {
    mocks.drainDiscountRemovals.mockResolvedValue({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      errorCodes: ['UNEXPECTED_SUBSCRIPTION_DISCOUNT'],
    });
    const response = await POST(request('t=1,v1=valid'));
    expect(response.status).toBe(503);
    expect(mocks.reconcileStripeEvent).toHaveBeenCalledTimes(1);
    expect(mocks.drainProjectionOutbox).toHaveBeenCalledTimes(1);
  });

  describe('checkout ownership with real reconciliation', () => {
    const context: BillingReconciliationContext = {
      canonicalUserId: '00000000-0000-4000-8000-000000000001',
      selectedOffer: 'STANDARD_INDIVIDUAL',
      stripeCustomerId: 'cus_known',
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: 'cs_current',
      setupFeePaidAt: null,
      normalizedState: 'PENDING_CHECKOUT',
      paymentMethodRequired: false,
      graceStartedAt: null,
      graceUntil: null,
      sotfQualifyingPaidCycles: 0,
    };
    const store = { resolveByCustomer: vi.fn(), apply: vi.fn() };
    const retrieveSession = vi.fn();

    beforeEach(async () => {
      const original = await vi.importActual<typeof import('@/lib/billing/reconciliation')>(
        '@/lib/billing/reconciliation',
      );
      mocks.reconcileStripeEvent.mockImplementation(original.reconcileStripeEvent);
      mocks.getStripeClient.mockReturnValue({
        webhooks: { constructEventAsync: mocks.constructEventAsync },
        checkout: { sessions: { retrieve: retrieveSession } },
      });
      mocks.getBillingConfig.mockReturnValue({
        monthlyPriceId: 'price_monthly',
        setupPriceId: 'price_setup',
      });
      mocks.createStore.mockReturnValue(store);
      store.resolveByCustomer.mockResolvedValue(context);
      store.apply.mockResolvedValue({ applicationResult: 'IGNORED' });
    });

    it.each([
      ['obsolete expiration', 'checkout.session.expired', 'cs_replaced', true, true, 200, 'IGNORED'],
      ['completed ownership mismatch', 'checkout.session.completed', 'cs_replaced', true, true, 400, 'CHECKOUT_OWNERSHIP_MISMATCH'],
      ['unknown customer', 'checkout.session.expired', 'cs_replaced', false, true, 400, 'UNKNOWN_STRIPE_CUSTOMER'],
      ['metadata contradiction', 'checkout.session.expired', 'cs_current', true, false, 400, 'STRIPE_METADATA_CONTRADICTION'],
    ])('handles %s without state writes or downstream drains', async (
      _name, eventType, sessionId, knownCustomer, validMetadata, status, result,
    ) => {
      const signedEvent = {
        id: 'evt_checkout', type: eventType, created: 1_800_000_100,
        data: { object: { id: sessionId } },
      };
      mocks.constructEventAsync.mockResolvedValue(signedEvent);
      store.resolveByCustomer.mockResolvedValue(knownCustomer ? context : null);
      retrieveSession.mockResolvedValue({
        id: sessionId,
        customer: context.stripeCustomerId,
        metadata: {
          canonical_user_id: validMetadata ? context.canonicalUserId : 'another_user',
          commercial_offer: context.selectedOffer,
        },
      });

      const response = await POST(request('t=1,v1=valid'));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(status === 200
        ? { received: true, result }
        : { error: result });
      expect(mocks.constructEventAsync).toHaveBeenCalledWith(
        '{"signed":"raw-body"}', 't=1,v1=valid', 'whsec_test',
      );
      expect(retrieveSession).toHaveBeenCalledWith(sessionId, { expand: ['line_items'] });
      expect(store.resolveByCustomer).toHaveBeenCalledWith(context.stripeCustomerId);
      expect(store.apply).not.toHaveBeenCalled();
      expect(mocks.createLifecycleStore).not.toHaveBeenCalled();
      expect(mocks.drainDiscountRemovals).not.toHaveBeenCalled();
      expect(mocks.drainProjectionOutbox).not.toHaveBeenCalled();
    });

    it('retains persistence and downstream drains for the current expired checkout', async () => {
      mocks.constructEventAsync.mockResolvedValue({
        id: 'evt_current_expired', type: 'checkout.session.expired', created: 1_800_000_100,
        data: { object: { id: context.stripeCheckoutSessionId } },
      });
      retrieveSession.mockResolvedValue({
        id: context.stripeCheckoutSessionId,
        customer: context.stripeCustomerId,
        metadata: {
          canonical_user_id: context.canonicalUserId,
          commercial_offer: context.selectedOffer,
        },
        line_items: { data: [{ price: 'price_monthly' }, { price: 'price_setup' }] },
      });

      const response = await POST(request('t=1,v1=valid'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, result: 'IGNORED' });
      expect(store.apply).toHaveBeenCalledTimes(1);
      expect(store.apply).toHaveBeenCalledWith(expect.objectContaining({
        stripeCheckoutSessionId: context.stripeCheckoutSessionId,
        reconciliationOutcome: 'IGNORED',
        normalizedState: null,
      }));
      expect(mocks.drainDiscountRemovals).toHaveBeenCalledTimes(1);
      expect(mocks.drainProjectionOutbox).toHaveBeenCalledTimes(1);
    });
  });
});
