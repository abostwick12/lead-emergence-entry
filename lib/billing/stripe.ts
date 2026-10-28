import 'server-only';

import Stripe from 'stripe';
import { getBillingConfig } from '@/lib/billing/config';

export const STRIPE_API_VERSION = '2026-07-29.dahlia' as const;

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

export function getStripeClient(): Stripe {
  return createStripeClient(getBillingConfig().stripeSecretKey);
}
