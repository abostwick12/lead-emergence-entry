import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
