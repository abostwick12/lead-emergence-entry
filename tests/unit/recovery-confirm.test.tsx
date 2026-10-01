// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));

import ConfirmRecoveryPage from '@/app/recover/confirm/page';

describe('customer recovery confirmation', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/recover/confirm');
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it('does not consume a recovery token on GET/render', async () => {
    window.history.replaceState(null, '', '/recover/confirm#token_hash=customer-only-hash');
    render(<ConfirmRecoveryPage />);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#token_hash=customer-only-hash');
    expect(screen.getByRole('button', { name: 'Continue to choose a password' })).toBeEnabled();
  });

  it('verifies only after explicit confirmation with exact recovery type, then reaches password update', async () => {
    window.history.replaceState(null, '', '/recover/confirm#token_hash=customer-only-hash');
    render(<ConfirmRecoveryPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to choose a password' }));
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: 'customer-only-hash', type: 'recovery',
    }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/update-password'));
  });

  it('fails closed for an invalid or expired token', async () => {
    window.history.replaceState(null, '', '/recover/confirm#token_hash=expired-hash');
    mocks.verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
    render(<ConfirmRecoveryPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to choose a password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('cannot confirm when the link has no recovery hash', async () => {
    render(<ConfirmRecoveryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
    expect(screen.getByRole('button', { name: 'Continue to choose a password' })).toBeDisabled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
