import { describe, expect, it } from 'vitest';
import { emailOtpDestination, entryLoginPath, safeEmailOtpType, safeEntryReturnPath } from '@/lib/navigation';
import { productOAuthStartUrl, isTrustedOAuthFormOrigin, safeExactOAuthRedirect, safeOAuthRedirect, uniqueConfiguredProduct, uniqueOAuthRedirectProduct } from '@/lib/oauth/contracts';

describe('Entry OAuth navigation contracts', () => {
  it('restores the exact internal consent continuation', () => {
    const continuation = '/oauth/consent?authorization_id=4e5dbf87-cfcb-4ac6-897a-b28812fa60ba';
    expect(safeEntryReturnPath(continuation)).toBe(continuation);
    expect(safeEntryReturnPath('/update-password')).toBe('/update-password');
  });

  it('preserves only exact internal product handoffs through the canonical login', () => {
    expect(safeEntryReturnPath('/handoff/personal')).toBe('/handoff/personal');
    expect(safeEntryReturnPath('/handoff/ministry')).toBe('/handoff/ministry');
    expect(safeEntryReturnPath('/handoff/consulting')).toBe('/handoff/consulting');
    expect(entryLoginPath('/handoff/ministry')).toBe('/login?next=%2Fhandoff%2Fministry');
    expect(safeEntryReturnPath('/handoff/unknown')).toBe('/workspaces');
    expect(safeEntryReturnPath('/handoff/personal?next=https://attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/handoff/personal#fragment')).toBe('/workspaces');
  });

  it('rejects external, scheme-relative, backslash, and unrelated continuations', () => {
    expect(safeEntryReturnPath('https://attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('//attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/\\attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/oauth/consent?authorization_id=ok&next=https://attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/auth/callback?code=stolen')).toBe('/workspaces');
  });

  it('accepts only supported email OTP types and forces password setup after invitations', () => {
    expect(safeEmailOtpType('invite')).toBe('invite');
    expect(safeEmailOtpType('recovery')).toBe('recovery');
    expect(safeEmailOtpType('not-a-real-type')).toBeNull();
    expect(emailOtpDestination('invite', '/workspaces')).toBe('/update-password');
    expect(emailOtpDestination('recovery', '/account')).toBe('/update-password');
    expect(emailOtpDestination('email', '/account')).toBe('/account');
    expect(emailOtpDestination('email', 'https://attacker.example')).toBe('/workspaces');
  });

  it('builds the direct Consulting OAuth start without credentials', () => {
    expect(productOAuthStartUrl('https://workspace.example.test/base')).toBe('https://workspace.example.test/auth/entry');
    expect(productOAuthStartUrl('http://127.0.0.1:3400/base', true)).toBe('http://127.0.0.1:3400/auth/entry');
    expect(() => productOAuthStartUrl('https://user:password@consulting.example.test')).toThrow();
    expect(() => productOAuthStartUrl('http://consulting.example.test', false)).toThrow();
    expect(() => productOAuthStartUrl('file:///tmp/consulting', true)).toThrow();
  });

  it('allows only same-origin decisions and safe OAuth callbacks', () => {
    expect(isTrustedOAuthFormOrigin('https://entry.example.test/api/oauth/decision', 'https://entry.example.test', 'https://entry.example.test')).toBe(true);
    expect(isTrustedOAuthFormOrigin('https://entry.example.test/api/oauth/decision', 'https://attacker.example', 'https://entry.example.test')).toBe(false);
    expect(safeOAuthRedirect('https://consulting-auth.example.test/auth/v1/callback?code=ok', 'https://consulting-auth.example.test')?.hostname).toBe('consulting-auth.example.test');
    expect(safeOAuthRedirect('http://127.0.0.1:54321/auth/v1/callback?code=ok', 'http://127.0.0.1:54321', true)?.port).toBe('54321');
    expect(safeOAuthRedirect('https://other-auth.example.test/auth/v1/callback?code=ok', 'https://consulting-auth.example.test')).toBeNull();
    expect(safeOAuthRedirect('https://consulting-auth.example.test/other/callback?code=ok', 'https://consulting-auth.example.test')).toBeNull();
    expect(safeOAuthRedirect('javascript:alert(1)', 'https://consulting-auth.example.test')).toBeNull();
  });

  it('allows an MCP authorization response only at the exact registered redirect URI', () => {
    const registered = 'http://127.0.0.1:49321/callback?channel=desktop';
    expect(safeExactOAuthRedirect(
      'http://127.0.0.1:49321/callback?channel=desktop&code=ok&state=state',
      registered,
    )?.port).toBe('49321');
    expect(safeExactOAuthRedirect(
      'http://127.0.0.1:49322/callback?channel=desktop&code=ok',
      registered,
    )).toBeNull();
    expect(safeExactOAuthRedirect(
      'http://127.0.0.1:49321/callback?channel=desktop&code=ok&next=https://attacker.example',
      registered,
    )).toBeNull();
  });

  it('maps a callback only when it belongs to exactly one product', () => {
    const products = ['PERSONAL', 'CONSULTING'] as const;
    const origins = {
      PERSONAL: 'https://personal-auth.example.test',
      CONSULTING: 'https://consulting-auth.example.test',
    };
    expect(uniqueOAuthRedirectProduct(
      'https://personal-auth.example.test/auth/v1/callback?code=ok',
      products,
      (product) => origins[product],
    )).toBe('PERSONAL');
    expect(uniqueOAuthRedirectProduct(
      'https://attacker.example.test/auth/v1/callback?code=ok',
      products,
      (product) => origins[product],
    )).toBeNull();
    expect(uniqueOAuthRedirectProduct(
      'https://shared-auth.example.test/auth/v1/callback?code=ok',
      products,
      () => 'https://shared-auth.example.test',
    )).toBeNull();
  });

  it('maps a client only when its identifier is unique to one product', () => {
    const products = ['PERSONAL', 'CONSULTING'] as const;
    expect(uniqueConfiguredProduct('personal-client', products, (product) => `${product.toLowerCase()}-client`)).toBe('PERSONAL');
    expect(uniqueConfiguredProduct('unknown-client', products, (product) => `${product.toLowerCase()}-client`)).toBeNull();
    expect(uniqueConfiguredProduct('shared-client', products, () => 'shared-client')).toBeNull();
  });
});
