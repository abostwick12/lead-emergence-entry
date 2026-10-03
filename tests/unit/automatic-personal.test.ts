import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { ensureAutomaticPersonalEntitlement } from '@/lib/identity/automatic-personal';

const canonicalUserId = '00000000-0000-4000-8000-0000000000f2';
const verifiedUser = { id: canonicalUserId, email_confirmed_at: '2026-09-19T12:00:00.000Z' };

describe('automatic PERSONAL entitlement', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://entry.example.test';
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
    vi.mocked(createClient).mockReturnValue({ rpc } as never);
  });

  it('does nothing for an anonymous request', async () => {
    await expect(ensureAutomaticPersonalEntitlement(null, 'PERSONAL')).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('does nothing for an unverified user', async () => {
    await expect(ensureAutomaticPersonalEntitlement({ id: canonicalUserId, email_confirmed_at: undefined }, 'PERSONAL')).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('activates only an absent PERSONAL entitlement with fixed trusted arguments', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [{ effective_status: 'ACTIVE' }], error: null });

    await expect(ensureAutomaticPersonalEntitlement(verifiedUser, 'PERSONAL')).resolves.toBe(true);

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_entry_product_entitlement_status', {
      p_canonical_user_id: canonicalUserId,
      p_product: 'PERSONAL',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_entry_product_entitlement', {
      p_canonical_user_id: canonicalUserId,
      p_product: 'PERSONAL',
      p_status: 'ACTIVE',
      p_source: 'phase_2_1_prebilling_automatic_personal',
      p_display_name: null,
    });
  });

  it('leaves an existing ACTIVE entitlement unchanged', async () => {
    rpc.mockResolvedValueOnce({ data: 'ACTIVE', error: null });

    await expect(ensureAutomaticPersonalEntitlement(verifiedUser, 'PERSONAL')).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_entry_product_entitlement_status', {
      p_canonical_user_id: canonicalUserId,
      p_product: 'PERSONAL',
    });
  });

  it.each(['PENDING', 'SUSPENDED', 'REVOKED'])('preserves an existing %s entitlement', async (status) => {
    rpc.mockResolvedValueOnce({ data: status, error: null });

    await expect(ensureAutomaticPersonalEntitlement(verifiedUser, 'PERSONAL')).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['CONSULTING', 'MINISTRY'] as const)('never grants %s', async (product) => {
    await expect(ensureAutomaticPersonalEntitlement(verifiedUser, product)).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});
