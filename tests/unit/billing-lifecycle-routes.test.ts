import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBillingConfig: vi.fn(),
  getStripeClient: vi.fn(),
  createStore: vi.fn(),
  getUser: vi.fn(),
  createPortalSessionForUser: vi.fn(),
  resumeSotfSubscriptionForUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/billing/config', () => ({ getBillingConfig: mocks.getBillingConfig }));
vi.mock('@/lib/billing/stripe', () => ({ getStripeClient: mocks.getStripeClient }));
vi.mock('@/lib/billing/store', () => ({ createEntryBillingLifecycleStore: mocks.createStore }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/billing/lifecycle', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/billing/lifecycle')>();
  return {
    ...original,
    createPortalSessionForUser: mocks.createPortalSessionForUser,
    resumeSotfSubscriptionForUser: mocks.resumeSotfSubscriptionForUser,
  };
});

import { POST as portalPost } from '@/app/api/billing/portal/route';
import { POST as resumePost } from '@/app/api/billing/resume/route';
import { BillingLifecycleError } from '@/lib/billing/lifecycle';

function request(path: string, body = '') {
  return new Request(`https://entry.example.test${path}`, {
    method: 'POST',
    headers: { origin: 'https://entry.example.test' },
    body,
  });
}

describe('Entry billing lifecycle routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBillingConfig.mockReturnValue({ entryOrigin: 'https://entry.example.test' });
    mocks.getStripeClient.mockReturnValue({ kind: 'stripe' });
    mocks.createStore.mockReturnValue({ kind: 'store' });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '00000000-0000-4000-8000-0000000000e1' } },
      error: null,
    });
    mocks.createPortalSessionForUser.mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    });
    mocks.resumeSotfSubscriptionForUser.mockResolvedValue({ disposition: 'RESUME_REQUESTED' });
  });

  it('rejects an unauthenticated Portal request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await portalPost(request('/api/billing/portal'));
    expect(response.status).toBe(401);
    expect(mocks.createPortalSessionForUser).not.toHaveBeenCalled();
  });

  it('rejects a browser-supplied Stripe Customer ID', async () => {
    const response = await portalPost(request(
      '/api/billing/portal',
      JSON.stringify({ customer: 'cus_attacker' }),
    ));
    expect(response.status).toBe(400);
    expect(mocks.createPortalSessionForUser).not.toHaveBeenCalled();
  });

  it('uses only the authenticated canonical user and redirects to the generated Portal URL', async () => {
    const response = await portalPost(request('/api/billing/portal'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://billing.stripe.test/session');
    expect(mocks.createPortalSessionForUser).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000e1',
      expect.objectContaining({ stripe: { kind: 'stripe' }, store: { kind: 'store' } }),
    );
  });

  it.each([
    new BillingLifecycleError('PORTAL_CONFIGURATION_POLICY_MISMATCH', 503),
    new Error('private Stripe failure details'),
  ])('returns Portal form failures to the account without exposing details', async (error) => {
    mocks.createPortalSessionForUser.mockRejectedValue(error);
    const response = await portalPost(request('/api/billing/portal'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://entry.example.test/account?billing=portal-error');
    expect(response.headers.get('location')).not.toContain(error.message);
  });

  it('rejects a browser-supplied Subscription ID', async () => {
    const response = await resumePost(request(
      '/api/billing/resume',
      JSON.stringify({ subscription: 'sub_attacker' }),
    ));
    expect(response.status).toBe(400);
    expect(mocks.resumeSotfSubscriptionForUser).not.toHaveBeenCalled();
  });

  it('rejects a browser-supplied Invoice ID', async () => {
    const response = await resumePost(request(
      '/api/billing/resume',
      JSON.stringify({ invoice: 'in_attacker' }),
    ));
    expect(response.status).toBe(400);
    expect(mocks.resumeSotfSubscriptionForUser).not.toHaveBeenCalled();
  });

  it('requests canonical resume and returns only to Entry without granting access', async () => {
    const response = await resumePost(request('/api/billing/resume'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://entry.example.test/account?resume=requested',
    );
    expect(mocks.resumeSotfSubscriptionForUser).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000e1',
      expect.objectContaining({ stripe: { kind: 'stripe' }, store: { kind: 'store' } }),
    );
  });

  it('returns a missing-payment-method failure to the account with an actionable status', async () => {
    mocks.resumeSotfSubscriptionForUser.mockRejectedValue(
      new BillingLifecycleError('USABLE_PAYMENT_METHOD_REQUIRED', 409),
    );
    const response = await resumePost(request('/api/billing/resume'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://entry.example.test/account?resume=payment-method-required',
    );
  });

  it.each([
    new BillingLifecycleError('SUBSCRIPTION_OWNERSHIP_MISMATCH', 409),
    new Error('private Stripe failure details'),
  ])('returns other resume failures to the account without exposing details', async (error) => {
    mocks.resumeSotfSubscriptionForUser.mockRejectedValue(error);
    const response = await resumePost(request('/api/billing/resume'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://entry.example.test/account?resume=failed');
    expect(response.headers.get('location')).not.toContain(error.message);
  });

  it('preserves origin rejection before the billing lifecycle runs', async () => {
    const response = await resumePost(new Request('https://entry.example.test/api/billing/resume', {
      method: 'POST',
      headers: { origin: 'https://other.example.test' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.resumeSotfSubscriptionForUser).not.toHaveBeenCalled();
  });
});
