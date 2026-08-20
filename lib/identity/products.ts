export const PRODUCTS = ['PERSONAL', 'MINISTRY', 'CONSULTING'] as const;
export type Product = (typeof PRODUCTS)[number];
export type EntitlementStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REVOKED';

export const PRODUCT_COPY: Record<Product, { name: string; tagline: string; description: string }> = {
  PERSONAL: { name: 'Personal', tagline: 'Lead Yourself', description: 'See clearly, align your attention, and lead intentionally.' },
  MINISTRY: { name: 'Ministry', tagline: 'Lead Others', description: 'Equip people, organize ministry, and create more space for relationships.' },
  CONSULTING: { name: 'Consulting', tagline: 'Lead Together', description: 'Guide organizations from observation toward meaningful new reality.' },
};

export function isActiveEntitlement(status: EntitlementStatus): boolean {
  return status === 'ACTIVE';
}
