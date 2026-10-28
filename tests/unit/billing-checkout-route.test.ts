import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  getUser: vi.fn(),
  createCheckoutForUser: vi.fn(),
  getEntryOrigin: vi.fn(),
  getBillingConfig: vi.fn(),
  createEntryBillingStore: vi.fn(),
  getStripeClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock('@/lib/billing/checkout', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/billing/checkout')>();
  return { ...original, createCheckoutForUser: mocks.createCheckoutForUser };
});
vi.mock('@/lib/billing/config', () => ({
  getEntryOrigin: mocks.getEntryOrigin,
  getBillingConfig: mocks.getBillingConfig,
}));
vi.mock('@/lib/billing/store', () => ({ createEntryBillingStore: mocks.createEntryBillingStore }));
vi.mock('@/lib/billing/stripe', () => ({ getStripeClient: mocks.getStripeClient }));

import { POST } from '@/app/api/billing/checkout/route';

const origin = 'https://entry.example.test';
const user = {
  id: '00000000-0000-4000-8000-0000000002b1',
  email: 'owner@example.invalid',
};

function checkoutRequest(body: unknown) {
  return new Request(`${origin}/api/billing/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEntryOrigin.mockReturnValue(origin);
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.getBillingConfig.mockReturnValue({ entryOrigin: origin });
    mocks.createEntryBillingStore.mockReturnValue({ kind: 'store' });
    mocks.getStripeClient.mockReturnValue({ kind: 'stripe' });
    mocks.createCheckoutForUser.mockResolvedValue({
      sessionId: 'cs_test_created',
      url: 'https://checkout.stripe.test/created',
      reused: false,
    });
  });

  it('rejects an unauthenticated Checkout request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(checkoutRequest({ offer: 'STANDARD_INDIVIDUAL' }));

    expect(response.status).toBe(401);
    expect(mocks.createCheckoutForUser).not.toHaveBeenCalled();
  });

  it('rejects client-supplied commercial authority fields', async () => {
    const response = await POST(checkoutRequest({
      offer: 'STANDARD_INDIVIDUAL',
      customer: 'cus_attacker',
      price: 'price_attacker',
      coupon: 'coupon_attacker',
      amount: 1,
      setupWaived: true,
      canonicalUserId: 'attacker-selected-user',
    }));

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutForUser).not.toHaveBeenCalled();
  });

  it('passes only the authenticated canonical identity and allowed offer', async () => {
    const response = await POST(checkoutRequest({ offer: 'SOTF_FOUNDING_FELLOW' }));

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutForUser).toHaveBeenCalledWith(
      { id: user.id, email: user.email },
      'SOTF_FOUNDING_FELLOW',
      expect.objectContaining({
        stripe: { kind: 'stripe' },
        store: { kind: 'store' },
        config: { entryOrigin: origin },
      }),
    );
  });

  it('rejects a cross-origin authenticated request', async () => {
    const request = checkoutRequest({ offer: 'STANDARD_INDIVIDUAL' });
    request.headers.set('origin', 'https://attacker.example.test');

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.createCheckoutForUser).not.toHaveBeenCalled();
  });
});
