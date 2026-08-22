import { describe, expect, it } from 'vitest';
import { isActiveEntitlement } from '@/lib/identity/products';
import { handoffClaimsSchema } from '@/lib/handoff/claims';

describe('identity boundaries', () => {
  it('allows only ACTIVE entitlements into products', () => {
    expect(isActiveEntitlement('ACTIVE')).toBe(true);
    expect(isActiveEntitlement('SUSPENDED')).toBe(false);
    expect(isActiveEntitlement('REVOKED')).toBe(false);
    expect(isActiveEntitlement('PENDING')).toBe(false);
  });

  it('rejects role and organization claims', () => {
    const result = handoffClaimsSchema.safeParse({
      iss: 'https://entry.example.com', sub: '00000000-0000-0000-0000-000000000000', aud: 'CONSULTING', iat: 1, exp: 2, jti: '00000000-0000-0000-0000-000000000001', role: 'CLIENT_ADMIN', organization_id: 'org-a',
    });
    expect(result.success).toBe(false);
  });

  it('keeps product entitlement independent from local authorization', () => {
    expect({ entry: 'ACTIVE', consultingLink: 'NONE', consultingMembership: 'NONE' }).toMatchObject({ entry: 'ACTIVE' });
    expect('ACTIVE CONSULTING').not.toContain('CLIENT_ADMIN');
  });
});
