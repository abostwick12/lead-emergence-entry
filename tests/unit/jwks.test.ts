import { describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, importPKCS8 } from 'jose';

describe('Entry JWKS contract', () => {
  it('publishes verification metadata only', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    expect(jwk).not.toHaveProperty('d');
    expect(jwk).not.toHaveProperty('p');
    expect(jwk).not.toHaveProperty('q');
  });

  it('does not import a private key into browser-facing code', async () => {
    vi.stubEnv('PRODUCT_HANDOFF_PRIVATE_KEY', '');
    expect(process.env.PRODUCT_HANDOFF_PRIVATE_KEY).toBe('');
    await expect(importPKCS8('not-a-key', 'RS256')).rejects.toThrow();
  });
});