import 'server-only';

import { z } from 'zod';

const billingEnvironmentSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_INDIVIDUAL_MONTHLY_PRICE_ID: z.string().min(1),
  STRIPE_SETUP_PRICE_ID: z.string().min(1),
  STRIPE_SOTF_COUPON_ID: z.string().min(1),
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().min(1),
  APP_ORIGIN: z.string().url(),
});

export type BillingConfig = {
  stripeSecretKey: string;
  monthlyPriceId: string;
  setupPriceId: string;
  sotfCouponId: string;
  portalConfigurationId: string;
  entryOrigin: string;
};

export function getEntryOrigin(): string {
  const rawOrigin = z.string().url().parse(process.env.APP_ORIGIN);
  const parsed = new URL(rawOrigin);
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');
  }
  return parsed.origin;
}

export function getBillingConfig(): BillingConfig {
  const env = billingEnvironmentSchema.parse(process.env);
  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    monthlyPriceId: env.STRIPE_INDIVIDUAL_MONTHLY_PRICE_ID,
    setupPriceId: env.STRIPE_SETUP_PRICE_ID,
    sotfCouponId: env.STRIPE_SOTF_COUPON_ID,
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
    entryOrigin: getEntryOrigin(),
  };
}

export function getStripeWebhookSecret(): string {
  return z.string().min(1).parse(process.env.STRIPE_WEBHOOK_SECRET);
}
