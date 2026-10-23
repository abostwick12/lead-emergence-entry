import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingLifecycleContext } from '@/lib/billing/store';

const mocks = vi.hoisted(() => ({
  createEntryBillingLifecycleStore: vi.fn(),
  resolveByCanonicalUser: vi.fn(),
  requireCanonicalIdentity: vi.fn(),
}));

vi.mock('@/lib/billing/store', () => ({
  createEntryBillingLifecycleStore: mocks.createEntryBillingLifecycleStore,
}));
vi.mock('@/lib/identity/server', () => ({
  requireCanonicalIdentity: mocks.requireCanonicalIdentity,
}));

import AccountPage from '@/app/account/page';

async function renderAccount(searchParams: { billing?: string; resume?: string } = {}) {
  return renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve(searchParams) }));
}

const billing: BillingLifecycleContext = {
  canonicalUserId: 'synthetic-user', selectedOffer: 'SOTF_FOUNDING_FELLOW',
  stripeCustomerId: 'cus_fixture', stripeSubscriptionId: 'sub_fixture',
  normalizedState: 'PAUSED_NO_PAYMENT_METHOD', paymentMethodRequired: true,
  graceUntil: null, sotfQualifyingPaidCycles: 0,
  discountRemovalDue: false, discountRemovedAt: null,
};

describe('account billing availability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireCanonicalIdentity.mockResolvedValue({ user: { id: billing.canonicalUserId } });
    mocks.createEntryBillingLifecycleStore.mockReturnValue({ resolveByCanonicalUser: mocks.resolveByCanonicalUser });
    mocks.resolveByCanonicalUser.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['store construction', 'lookup'])(
    'keeps account sections readable when billing %s fails', async (failure) => {
      const error = new Error('private billing failure details');
      if (failure === 'store construction') mocks.createEntryBillingLifecycleStore.mockImplementation(() => { throw error; });
      else mocks.resolveByCanonicalUser.mockRejectedValue(error);

      const markup = await renderAccount();

      expect(markup).toContain('<h2>Profile</h2>');
      expect(markup).toContain('<h2>Product access</h2>');
      expect(markup).toContain('Billing is temporarily unavailable. Please try again shortly.');
      expect(markup).not.toContain('No customer-managed Stripe billing relationship');
      expect(markup).not.toContain('/api/billing/portal');
      expect(markup).not.toContain('/api/billing/resume');
      expect(markup).not.toContain(error.message);
      expect(console.error).toHaveBeenCalledExactlyOnceWith('Account billing lookup unavailable');
      expect(mocks.requireCanonicalIdentity).toHaveBeenCalledWith('/account');
    },
  );

  it('retains the empty billing state after a successful lookup', async () => {
    const markup = await renderAccount();
    expect(markup).toContain('No customer-managed Stripe billing relationship');
    expect(markup).not.toContain('Billing is temporarily unavailable');
    expect(markup).not.toContain('/api/billing/portal');
    expect(mocks.resolveByCanonicalUser).toHaveBeenCalledWith(billing.canonicalUserId);
  });

  it('retains billing and resume actions for a known paused subscription', async () => {
    mocks.resolveByCanonicalUser.mockResolvedValue(billing);
    const markup = await renderAccount();
    expect(markup).toContain('/api/billing/portal');
    expect(markup).toContain('/api/billing/resume');
    expect(markup).not.toContain('Billing is temporarily unavailable');
  });

  it('keeps the identity gate outside billing failure handling', async () => {
    const error = new Error('identity redirect');
    mocks.requireCanonicalIdentity.mockRejectedValue(error);
    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toBe(error);
    expect(mocks.createEntryBillingLifecycleStore).not.toHaveBeenCalled();
    expect(mocks.resolveByCanonicalUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ resume: 'payment-method-required' }, 'Use Update payment method, then try resuming your subscription again.'],
    [{ resume: 'failed' }, 'We could not resume your subscription. Please try again shortly.'],
    [{ billing: 'portal-error' }, 'We could not open billing. Please try again shortly.'],
  ])('shows a fixed billing form failure message', async (params, message) => {
    mocks.resolveByCanonicalUser.mockResolvedValue(billing);
    const markup = await renderAccount(params);
    expect(markup).toContain(`<p role="alert">${message}</p>`);
    expect(markup).toContain('<h2>Profile</h2>');
    expect(markup).toContain('/api/billing/portal');
  });

  it('ignores unrecognized billing status text', async () => {
    const markup = await renderAccount({ resume: 'private failure details' });
    expect(markup).not.toContain('private failure details');
    expect(markup).not.toContain('role="alert"');
  });
});
