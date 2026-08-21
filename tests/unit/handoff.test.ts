import { describe, expect, it } from 'vitest';
import { compactVerify, decodeJwt, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { handoffClaimsSchema, productUrl } from '@/lib/handoff/claims';

async function token(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://entry.example.test', sub: '00000000-0000-4000-8000-000000000001', aud: 'CONSULTING', iat: now, exp: now + 90, jti: '00000000-0000-4000-8000-000000000002', ...overrides };
  return { token: await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'entry-test' }).sign(privateKey), publicKey, claims };
}

describe('handoff protocol', () => {
  it('accepts the correct audience and rejects wrong audience', async () => {
    const valid = await token();
    await compactVerify(valid.token, valid.publicKey);
    expect(handoffClaimsSchema.parse(decodeJwt(valid.token))).toMatchObject({ aud: 'CONSULTING' });
    const wrong = await token({ aud: 'MINISTRY' });
    expect(handoffClaimsSchema.parse(decodeJwt(wrong.token)).aud).not.toBe('CONSULTING');
  });

  it('rejects expired assertions and modified signatures', async () => {
    const expired = await token({ exp: Math.floor(Date.now() / 1000) - 1 });
    await expect(jwtVerify(expired.token, expired.publicKey)).rejects.toThrow();
    const valid = await token();
    const parts = valid.token.split('.');
    const signature = parts[2];
    const replacement = signature[0] === 'a' ? 'b' : 'a';
    const modified = `${parts[0]}.${parts[1]}.${replacement}${signature.slice(1)}`;
    await expect(jwtVerify(modified, valid.publicKey)).rejects.toThrow();
  });

  it('does not permit credentials or non-http product destinations', () => {
    process.env.CONSULTING_PRODUCT_URL = 'https://user:password@consulting.example.test';
    expect(() => productUrl('CONSULTING')).toThrow();
    process.env.CONSULTING_PRODUCT_URL = 'javascript:alert(1)';
    expect(() => productUrl('CONSULTING')).toThrow();
    process.env.CONSULTING_PRODUCT_URL = 'https://consulting.example.test';
  });

  it('claims contain no product authorization data', async () => {
    const generated = await token();
    const claims = handoffClaimsSchema.parse(decodeJwt(generated.token));
    expect(claims).not.toHaveProperty('role');
    expect(claims).not.toHaveProperty('organization_id');
    expect(claims).not.toHaveProperty('engagement_id');
  });
});
