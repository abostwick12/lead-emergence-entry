import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  listUsers: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  createClient: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { requestOperatorRecovery } from '@/app/operator/signups/actions';

const reader = { app_metadata: { entry_signup_reader: true } };

function request(email: string) {
  const form = new FormData();
  form.set('email', email);
  return requestOperatorRecovery(form);
}

describe('operator recovery request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = 'https://entry.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    process.env.SUPABASE_SECRET_KEY = 'secret-test-key';
    mocks.getUser.mockResolvedValue({ data: { user: reader }, error: null });
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ email: 'existing@example.test', created_at: '2026-10-01T00:00:00Z' }], nextPage: null },
      error: null,
    });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.createClient.mockImplementation((_url: string, key: string) => key === 'secret-test-key'
      ? { auth: { admin: { listUsers: mocks.listUsers } } }
      : { auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } });
  });

  it.each([
    null,
    { app_metadata: {} },
    { app_metadata: { entry_signup_reader: false } },
    { app_metadata: { entry_signup_reader: 'true' } },
  ])('denies a missing or non-reader operator before admin or mail calls: %j', async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    await expect(request('existing@example.test')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('sends to a freshly listed Entry account without using the operator session for delivery', async () => {
    await expect(request('existing@example.test')).rejects.toThrow('NEXT_REDIRECT:/operator/signups?recovery=requested');
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 });
    expect(mocks.createClient).toHaveBeenLastCalledWith('https://auth.example.test', 'publishable-test-key', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('existing@example.test', {
      redirectTo: 'https://entry.example.test/auth/callback?next=%2Fupdate-password',
    });
  });

  it('denies arbitrary or nonexistent email without sending', async () => {
    await expect(request('other@example.test')).rejects.toThrow('NEXT_REDIRECT:/operator/signups?recovery=unavailable');
    expect(mocks.listUsers).toHaveBeenCalledOnce();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('fails closed when the directory cannot be completely read', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listUsers.mockResolvedValue({ data: null, error: { message: 'directory unavailable' } });
    await expect(request('existing@example.test')).rejects.toThrow('NEXT_REDIRECT:/operator/signups?recovery=unavailable');
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('does not report success when Supabase rejects the delivery request', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { code: 'smtp_failure', status: 503, message: 'secret-url' } });
    await expect(request('existing@example.test')).rejects.toThrow('NEXT_REDIRECT:/operator/signups?recovery=unavailable');
    expect(errorLog).toHaveBeenCalledWith('Operator recovery request rejected', { code: 'smtp_failure', status: 503 });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-url');
    errorLog.mockRestore();
  });

  it('never returns provider recovery credentials to the operator', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      data: { token_hash: 'private-hash', action_link: 'https://example.test/private-link' },
      error: null,
    });
    await expect(request('existing@example.test')).rejects.toThrow('NEXT_REDIRECT:/operator/signups?recovery=requested');
    expect(mocks.redirect).toHaveBeenLastCalledWith('/operator/signups?recovery=requested');
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain('private-hash');
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain('private-link');
  });
});
