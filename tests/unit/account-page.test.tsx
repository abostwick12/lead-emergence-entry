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

      const markup = renderToStaticMarkup(await AccountPage());

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
    const markup = renderToStaticMarkup(await AccountPage());
    expect(markup).toContain('No customer-managed Stripe billing relationship');
    expect(markup).not.toContain('Billing is temporarily unavailable');
    expect(markup).not.toContain('/api/billing/portal');
    expect(mocks.resolveByCanonicalUser).toHaveBeenCalledWith(billing.canonicalUserId);
  });

  it('retains billing and resume actions for a known paused subscription', async () => {
    mocks.resolveByCanonicalUser.mockResolvedValue(billing);
    const markup = renderToStaticMarkup(await AccountPage());
    expect(markup).toContain('/api/billing/portal');
    expect(markup).toContain('/api/billing/resume');
    expect(markup).not.toContain('Billing is temporarily unavailable');
  });

  it('keeps the identity gate outside billing failure handling', async () => {
    const error = new Error('identity redirect');
    mocks.requireCanonicalIdentity.mockRejectedValue(error);
    await expect(AccountPage()).rejects.toBe(error);
    expect(mocks.createEntryBillingLifecycleStore).not.toHaveBeenCalled();
    expect(mocks.resolveByCanonicalUser).not.toHaveBeenCalled();
  });
});
