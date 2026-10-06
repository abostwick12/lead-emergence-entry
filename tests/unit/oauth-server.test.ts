import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  ensureAutomaticPersonalEntitlement: vi.fn(),
  getActiveProducts: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/identity/automatic-personal', () => ({
  ensureAutomaticPersonalEntitlement: mocks.ensureAutomaticPersonalEntitlement,
}));
vi.mock('@/lib/identity/server', () => ({ getActiveProducts: mocks.getActiveProducts }));

import { createProductOAuthStart } from '@/lib/oauth/server';

const verifiedUser = {
  id: '00000000-0000-4000-8000-0000000000f3',
  email_confirmed_at: '2026-09-19T16:00:00.000Z',
};

describe('product OAuth start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PERSONAL_PRODUCT_URL = 'https://workspace.example.test';
    process.env.CONSULTING_PRODUCT_URL = 'https://consulting.example.test';
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: verifiedUser }, error: null });
    mocks.ensureAutomaticPersonalEntitlement.mockResolvedValue(true);
  });

  it('ensures an authenticated PERSONAL entitlement before authorization', async () => {
    mocks.getActiveProducts.mockResolvedValue(['PERSONAL']);

    await expect(createProductOAuthStart('PERSONAL')).resolves.toBe('https://workspace.example.test/auth/entry');

    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledWith(verifiedUser, 'PERSONAL');
    expect(mocks.ensureAutomaticPersonalEntitlement.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getActiveProducts.mock.invocationCallOrder[0]);
  });

  it('preserves denial when PERSONAL remains non-active', async () => {
    mocks.ensureAutomaticPersonalEntitlement.mockResolvedValue(false);
    mocks.getActiveProducts.mockResolvedValue([]);

    await expect(createProductOAuthStart('PERSONAL')).resolves.toBeNull();

    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledWith(verifiedUser, 'PERSONAL');
    expect(mocks.getActiveProducts).toHaveBeenCalledTimes(1);
  });

  it('does not invoke automatic entitlement logic for CONSULTING', async () => {
    mocks.getActiveProducts.mockResolvedValue(['CONSULTING']);

    await expect(createProductOAuthStart('CONSULTING')).resolves.toBe('https://consulting.example.test/auth/entry');

    expect(mocks.ensureAutomaticPersonalEntitlement).not.toHaveBeenCalled();
  });

  it('does not evaluate entitlement for an anonymous request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(createProductOAuthStart('PERSONAL')).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.ensureAutomaticPersonalEntitlement).not.toHaveBeenCalled();
    expect(mocks.getActiveProducts).not.toHaveBeenCalled();
  });

  it('does not authorize an unverified PERSONAL request without an active entitlement', async () => {
    const unverifiedUser = { id: verifiedUser.id, email_confirmed_at: undefined };
    mocks.getUser.mockResolvedValue({ data: { user: unverifiedUser }, error: null });
    mocks.ensureAutomaticPersonalEntitlement.mockResolvedValue(false);
    mocks.getActiveProducts.mockResolvedValue([]);

    await expect(createProductOAuthStart('PERSONAL')).resolves.toBeNull();

    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledWith(unverifiedUser, 'PERSONAL');
  });
});
