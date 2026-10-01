import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  redirect: vi.fn((_path: string) => { throw new Error('NEXT_REDIRECT'); }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } })),
}));

import { requestPasswordRecovery } from '@/app/forgot-password/actions';

describe('shared recovery email template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = 'https://entry.example.test';
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it('uses a first-party fragment so loading the interstitial does not send the token hash to the server', () => {
    const template = readFileSync('supabase/templates/recovery.html', 'utf8');
    const config = readFileSync('supabase/config.toml', 'utf8');
    expect(template).toContain('href="{{ .SiteURL }}/recover/confirm#token_hash={{ .TokenHash }}"');
    expect(template).not.toContain('.ConfirmationURL');
    expect(config).toContain('[auth.email.template.recovery]');
    expect(config).toContain('content_path = "./supabase/templates/recovery.html"');
  });

  it('keeps self-service recovery on Supabase delivery, which uses the same recovery template', async () => {
    const form = new FormData();
    form.set('email', 'customer@example.test');
    await expect(requestPasswordRecovery(form)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('customer@example.test', {
      redirectTo: 'https://entry.example.test/auth/callback?next=%2Fupdate-password',
    });
    expect(mocks.redirect).toHaveBeenLastCalledWith('/forgot-password?sent=1');
  });
});
