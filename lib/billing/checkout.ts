import 'server-only';

import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { z } from 'zod';
import type { BillingConfig } from '@/lib/billing/config';
import type { CheckoutBillingStore, CheckoutReservation } from '@/lib/billing/store';

export const checkoutOfferSchema = z.enum(['STANDARD_INDIVIDUAL', 'SOTF_FOUNDING_FELLOW']);
export const checkoutRequestSchema = z.object({ offer: checkoutOfferSchema }).strict();
export type CheckoutOffer = z.infer<typeof checkoutOfferSchema>;

type EntryCheckoutUser = {
  id: string;
  email?: string | null;
};

type CheckoutDependencies = {
  stripe: Stripe;
  store: CheckoutBillingStore;
  config: BillingConfig;
  createAttemptId?: () => string;
};

export type CheckoutResult = {
  sessionId: string;
  url: string;
  reused: boolean;
};

export class BillingCheckoutError extends Error {
  constructor(
    public readonly code:
      | 'SOTF_NOT_ELIGIBLE'
      | 'CHECKOUT_IN_PROGRESS'
      | 'CHECKOUT_OFFER_CONFLICT'
      | 'CHECKOUT_ALREADY_COMPLETED'
      | 'CHECKOUT_UNAVAILABLE',
    public readonly status: number,
  ) {
    super(code);
  }
}

function checkoutMetadata(canonicalUserId: string, offer: CheckoutOffer, attemptId: string) {
  return {
    canonical_user_id: canonicalUserId,
    commercial_offer: offer,
    checkout_attempt_id: attemptId,
  };
}

export function buildCheckoutSessionParams(input: {
  canonicalUserId: string;
  stripeCustomerId: string;
  offer: CheckoutOffer;
  attemptId: string;
  config: BillingConfig;
}): Stripe.Checkout.SessionCreateParams {
  const metadata = checkoutMetadata(input.canonicalUserId, input.offer, input.attemptId);
  const common: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer: input.stripeCustomerId,
    client_reference_id: input.canonicalUserId,
    success_url: `${input.config.entryOrigin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.config.entryOrigin}/account?checkout=cancelled`,
    metadata,
    subscription_data: {
      trial_period_days: 14,
      metadata,
    },
  };

  if (input.offer === 'STANDARD_INDIVIDUAL') {
    return {
      ...common,
      payment_method_collection: 'always',
      line_items: [
        { price: input.config.setupPriceId, quantity: 1 },
        { price: input.config.monthlyPriceId, quantity: 1 },
      ],
    };
  }

  return {
    ...common,
    payment_method_collection: 'if_required',
    line_items: [{ price: input.config.monthlyPriceId, quantity: 1 }],
    discounts: [{ coupon: input.config.sotfCouponId }],
    subscription_data: {
      ...common.subscription_data,
      trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
    },
  };
}

function isMissingStripeResource(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'resource_missing');
}

async function inspectExistingSession(
  stripe: Stripe,
  reservation: CheckoutReservation,
  requestedOffer: CheckoutOffer,
): Promise<CheckoutResult | 'REPLACE'> {
  const sessionId = reservation.checkoutReference;
  if (!sessionId) throw new BillingCheckoutError('CHECKOUT_UNAVAILABLE', 503);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if (isMissingStripeResource(error)) return 'REPLACE';
    throw new BillingCheckoutError('CHECKOUT_UNAVAILABLE', 503);
  }

  if (session.status === 'expired') return 'REPLACE';
  if (session.status === 'complete') {
    throw new BillingCheckoutError('CHECKOUT_ALREADY_COMPLETED', 409);
  }
  if (reservation.selectedOffer !== requestedOffer) {
    throw new BillingCheckoutError('CHECKOUT_OFFER_CONFLICT', 409);
  }
  if (session.status !== 'open' || !session.url) {
    throw new BillingCheckoutError('CHECKOUT_UNAVAILABLE', 503);
  }
  return { sessionId: session.id, url: session.url, reused: true };
}

export async function createCheckoutForUser(
  user: EntryCheckoutUser,
  offer: CheckoutOffer,
  dependencies: CheckoutDependencies,
): Promise<CheckoutResult> {
  if (offer === 'SOTF_FOUNDING_FELLOW'
    && !await dependencies.store.isSotfEligible(user.id)) {
    throw new BillingCheckoutError('SOTF_NOT_ELIGIBLE', 403);
  }

  const attemptId = (dependencies.createAttemptId ?? randomUUID)();
  const reservationId = `checkout_attempt_${attemptId}`;
  let reservation = await dependencies.store.reserve({
    canonicalUserId: user.id,
    offer,
    reservationId,
    replaceCheckoutReference: null,
  });

  if (reservation.disposition === 'IN_PROGRESS') {
    throw new BillingCheckoutError('CHECKOUT_IN_PROGRESS', 409);
  }
  if (reservation.disposition === 'EXISTING_SESSION') {
    const existing = await inspectExistingSession(dependencies.stripe, reservation, offer);
    if (existing !== 'REPLACE') return existing;
    reservation = await dependencies.store.reserve({
      canonicalUserId: user.id,
      offer,
      reservationId,
      replaceCheckoutReference: reservation.checkoutReference,
    });
    if (reservation.disposition !== 'RESERVED') {
      throw new BillingCheckoutError('CHECKOUT_IN_PROGRESS', 409);
    }
  }

  try {
    const customerId = reservation.stripeCustomerId ?? (await dependencies.stripe.customers.create(
      {
        ...(user.email ? { email: user.email } : {}),
        metadata: { canonical_user_id: user.id },
      },
      { idempotencyKey: `lead-emergence-customer:${user.id}` },
    )).id;

    const session = await dependencies.stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        canonicalUserId: user.id,
        stripeCustomerId: customerId,
        offer,
        attemptId,
        config: dependencies.config,
      }),
      { idempotencyKey: `lead-emergence-checkout:${attemptId}` },
    );
    if (!session.url) throw new BillingCheckoutError('CHECKOUT_UNAVAILABLE', 503);

    const completed = await dependencies.store.complete({
      canonicalUserId: user.id,
      offer,
      reservationId,
      stripeCustomerId: customerId,
      stripeCheckoutSessionId: session.id,
    });
    if (!completed) throw new BillingCheckoutError('CHECKOUT_IN_PROGRESS', 409);
    return { sessionId: session.id, url: session.url, reused: false };
  } catch (error) {
    await dependencies.store.release(user.id, reservationId);
    throw error;
  }
}
