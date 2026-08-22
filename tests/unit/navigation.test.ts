import { describe, expect, it } from 'vitest';
import { safeEntryReturnPath } from '@/lib/navigation';
import { consultingOAuthStartUrl, isTrustedOAuthFormOrigin, safeOAuthRedirect } from '@/lib/oauth/contracts';

describe('Entry OAuth navigation contracts', () => {
  it('restores the exact internal consent continuation', () => {
    const continuation = '/oauth/consent?authorization_id=4e5dbf87-cfcb-4ac6-897a-b28812fa60ba';
    expect(safeEntryReturnPath(continuation)).toBe(continuation);
    expect(safeEntryReturnPath('/update-password')).toBe('/update-password');
  });

  it('rejects external, scheme-relative, backslash, and unrelated continuations', () => {
    expect(safeEntryReturnPath('https://attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('//attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/\\attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/oauth/consent?authorization_id=ok&next=https://attacker.example')).toBe('/workspaces');
    expect(safeEntryReturnPath('/auth/callback?code=stolen')).toBe('/workspaces');
  });

  it('builds the direct Consulting OAuth start without credentials', () => {
    expect(consultingOAuthStartUrl('https://consulting.example.test/base')).toBe('https://consulting.example.test/auth/entry');
    expect(consultingOAuthStartUrl('http://127.0.0.1:3400/base', true)).toBe('http://127.0.0.1:3400/auth/entry');
    expect(() => consultingOAuthStartUrl('https://user:password@consulting.example.test')).toThrow();
    expect(() => consultingOAuthStartUrl('http://consulting.example.test', false)).toThrow();
    expect(() => consultingOAuthStartUrl('file:///tmp/consulting', true)).toThrow();
  });

  it('allows only same-origin decisions and safe OAuth callbacks', () => {
    expect(isTrustedOAuthFormOrigin('https://entry.example.test/api/oauth/decision', 'https://entry.example.test', 'https://entry.example.test')).toBe(true);
    expect(isTrustedOAuthFormOrigin('https://entry.example.test/api/oauth/decision', 'https://attacker.example', 'https://entry.example.test')).toBe(false);
    expect(safeOAuthRedirect('https://consulting-auth.example.test/auth/v1/callback?code=ok', 'https://consulting-auth.example.test')?.hostname).toBe('consulting-auth.example.test');
    expect(safeOAuthRedirect('http://127.0.0.1:54321/auth/v1/callback?code=ok', 'http://127.0.0.1:54321', true)?.port).toBe('54321');
    expect(safeOAuthRedirect('https://other-auth.example.test/auth/v1/callback?code=ok', 'https://consulting-auth.example.test')).toBeNull();
    expect(safeOAuthRedirect('https://consulting-auth.example.test/other/callback?code=ok', 'https://consulting-auth.example.test')).toBeNull();
    expect(safeOAuthRedirect('javascript:alert(1)')).toBeNull();
  });
});
