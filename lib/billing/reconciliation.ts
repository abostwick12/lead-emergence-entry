import 'server-only';

import type Stripe from 'stripe';
import type { BillingConfig } from '@/lib/billing/config';
import type {
  ApplyReconciliationInput,
  BillingReconciliationContext,
  BillingReconciliationStore,
  BillingState,
  ReconciliationApplication,
} from '@/lib/billing/store';

const supportedEventTypes = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);

export class BillingReconciliationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function idOf(value: { id: string } | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function asIso(seconds: number | null | undefined): string | null {
  return seconds == null ? null : new Date(seconds * 1000).toISOString();
}

function eventIso(event: Stripe.Event): string {
  return new Date(event.created * 1000).toISOString();
}

function periodBounds(subscription: Stripe.Subscription) {
  const items = subscription.items.data;
  if (!items.length) return { startedAt: null, endsAt: null };
  return {
    startedAt: asIso(Math.min(...items.map((item) => item.current_period_start))),
    endsAt: asIso(Math.max(...items.map((item) => item.current_period_end))),
  };
}

function hasScheduledPeriodEndCancellation(subscription: Stripe.Subscription): boolean {
  if (subscription.cancel_at_period_end) return true;
  if (subscription.billing_mode?.type !== 'flexible' || subscription.cancel_at == null) {
    return false;
  }

  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  if (!periodEnds.length) return false;
  const applicablePeriodEnd = Math.max(...periodEnds);
  return subscription.cancel_at === applicablePeriodEnd
    && subscription.cancel_at > Math.floor(Date.now() / 1000);
}

function subscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  return subscription.items.data.map((item) => item.price.id).sort();
}

function discountCouponIds(subscription: Stripe.Subscription): string[] {
  return subscription.discounts.flatMap((discount) => {
    if (typeof discount === 'string' || discount.deleted) return [];
    const coupon = discount.source?.coupon;
    const couponId = idOf(coupon);
    return couponId ? [couponId] : [];
  });
}

function hasOnlyExpectedDiscount(
  subscription: Stripe.Subscription,
  expectedCouponId: string,
): boolean {
  const couponIds = discountCouponIds(subscription);
  return subscription.discounts.length === 1
    && couponIds.length === 1
    && couponIds[0] === expectedCouponId;
}

function invoicePriceIds(invoice: Stripe.Invoice): string[] {
  return invoice.lines.data.flatMap((line) => {
    const price = line.pricing?.price_details?.price;
    const priceId = idOf(price);
    return priceId ? [priceId] : [];
  });
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

function assertMetadata(
  metadata: Stripe.Metadata | null,
  context: BillingReconciliationContext,
) {
  if (metadata?.canonical_user_id !== context.canonicalUserId
    || metadata?.commercial_offer !== context.selectedOffer) {
    throw new BillingReconciliationError('STRIPE_METADATA_CONTRADICTION');
  }
}

function assertSubscription(
  subscription: Stripe.Subscription,
  context: BillingReconciliationContext,
  config: BillingConfig,
  requireSotfDiscount = true,
) {
  if (idOf(subscription.customer) !== context.stripeCustomerId) {
    throw new BillingReconciliationError('SUBSCRIPTION_CUSTOMER_MISMATCH');
  }
  if (context.stripeSubscriptionId && context.stripeSubscriptionId !== subscription.id) {
    throw new BillingReconciliationError('SUBSCRIPTION_OWNERSHIP_MISMATCH');
  }
  assertMetadata(subscription.metadata, context);
  const prices = subscriptionPriceIds(subscription);
  if (prices.length !== 1 || prices[0] !== config.monthlyPriceId) {
    throw new BillingReconciliationError('SUBSCRIPTION_PRICE_MISMATCH');
  }
  if (context.selectedOffer === 'STANDARD_INDIVIDUAL') {
    if (subscription.discounts.length !== 0) {
      throw new BillingReconciliationError('STANDARD_DISCOUNT_MISMATCH');
    }
  } else {
    const hasExpectedDiscount = hasOnlyExpectedDiscount(subscription, config.sotfCouponId);
    const hasNoDiscount = subscription.discounts.length === 0;
    if (!requireSotfDiscount && !hasExpectedDiscount && !hasNoDiscount) {
      throw new BillingReconciliationError('SOTF_DISCOUNT_MISMATCH');
    }
    if (requireSotfDiscount
      && context.sotfQualifyingPaidCycles < 12
      && !hasExpectedDiscount) {
      throw new BillingReconciliationError('SOTF_DISCOUNT_MISMATCH');
    }
    if (context.sotfQualifyingPaidCycles === 12
      && !hasExpectedDiscount
      && !hasNoDiscount) {
      throw new BillingReconciliationError('SOTF_DISCOUNT_MISMATCH');
    }
  }
}

function stateFromSubscription(
  subscription: Stripe.Subscription,
  context: BillingReconciliationContext,
  allowPaidRecovery = false,
): BillingState | null {
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    return 'CANCELED';
  }
  if (subscription.status === 'paused') return 'PAUSED_NO_PAYMENT_METHOD';
  if (subscription.status === 'trialing') return 'TRIALING';
  if (hasScheduledPeriodEndCancellation(subscription)) return 'CANCEL_AT_PERIOD_END';
  if (subscription.status === 'active') {
    if (context.normalizedState === 'PAYMENT_GRACE' && !allowPaidRecovery) {
      return 'PAYMENT_GRACE';
    }
    return 'ACTIVE';
  }
  if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    return context.normalizedState === 'PAYMENT_GRACE'
      ? 'PAYMENT_GRACE'
      : context.normalizedState;
  }
  return null;
}

function emptyApplication(
  event: Stripe.Event,
  context: BillingReconciliationContext,
  objectId: string,
): ApplyReconciliationInput {
  return {
    canonicalUserId: context.canonicalUserId,
    stripeEventId: event.id,
    eventType: event.type,
    stripeObjectId: objectId,
    stripeEventCreatedAt: eventIso(event),
    stripeCustomerId: context.stripeCustomerId,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    normalizedState: null,
    setupFeePaidAt: null,
    paymentMethodRequired: null,
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: null,
    invoiceAmountPaid: null,
    qualifyingPaidCycle: false,
    startGraceAt: null,
    clearGrace: false,
    enforceLogicalObjectDedupe: false,
    reconciliationOutcome: 'APPLIED',
  };
}

async function resolveContext(
  store: BillingReconciliationStore,
  customerId: string | null,
): Promise<BillingReconciliationContext> {
  if (!customerId) throw new BillingReconciliationError('STRIPE_CUSTOMER_REQUIRED');
  const context = await store.resolveByCustomer(customerId);
  if (!context) throw new BillingReconciliationError('UNKNOWN_STRIPE_CUSTOMER');
  return context;
}

async function retrieveSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['discounts', 'customer'],
  });
}

async function resolveTerminalSotfDiscounts(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<Stripe.Subscription['discounts']> {
  const discountReference = subscription.discounts.length === 1
    ? subscription.discounts[0]
    : null;
  if (typeof discountReference !== 'string') return subscription.discounts;

  let resolvedSubscription: Stripe.Subscription;
  try {
    resolvedSubscription = await retrieveSubscription(stripe, subscription.id);
  } catch {
    throw new BillingReconciliationError('SOTF_DISCOUNT_MISMATCH');
  }
  const resolvedDiscount = resolvedSubscription.discounts.length === 1
    ? resolvedSubscription.discounts[0]
    : null;
  if (!resolvedDiscount
    || typeof resolvedDiscount === 'string'
    || resolvedDiscount.deleted
    || resolvedDiscount.id !== discountReference) {
    throw new BillingReconciliationError('SOTF_DISCOUNT_MISMATCH');
  }
  return resolvedSubscription.discounts;
}

function attachSubscriptionState(
  application: ApplyReconciliationInput,
  subscription: Stripe.Subscription,
  context: BillingReconciliationContext,
  allowPaidRecovery = false,
) {
  const period = periodBounds(subscription);
  application.stripeSubscriptionId = subscription.id;
  application.normalizedState = stateFromSubscription(subscription, context, allowPaidRecovery);
  application.trialStartedAt = asIso(subscription.trial_start);
  application.trialEndsAt = asIso(subscription.trial_end);
  application.currentPeriodStartedAt = period.startedAt;
  application.currentPeriodEndsAt = period.endsAt;
  application.cancelAtPeriodEnd = hasScheduledPeriodEndCancellation(subscription);
}

async function reconcileCheckoutEvent(
  event: Stripe.Event,
  stripe: Stripe,
  store: BillingReconciliationStore,
  config: BillingConfig,
): Promise<ReconciliationApplication> {
  const eventSession = event.data.object as Stripe.Checkout.Session;
  const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
    expand: ['line_items'],
  });
  const context = await resolveContext(store, idOf(session.customer));
  if (context.stripeCheckoutSessionId !== session.id) {
    throw new BillingReconciliationError('CHECKOUT_OWNERSHIP_MISMATCH');
  }
  assertMetadata(session.metadata, context);

  const priceIds = (session.line_items?.data ?? []).flatMap((item) => {
    const priceId = idOf(item.price);
    return priceId ? [priceId] : [];
  }).sort();
  const expected = context.selectedOffer === 'STANDARD_INDIVIDUAL'
    ? [config.monthlyPriceId, config.setupPriceId].sort()
    : [config.monthlyPriceId];
  if (priceIds.length !== expected.length
    || priceIds.some((price, index) => price !== expected[index])) {
    throw new BillingReconciliationError('CHECKOUT_PRICE_MISMATCH');
  }

  const application = emptyApplication(event, context, session.id);
  application.stripeCheckoutSessionId = session.id;
  if (event.type === 'checkout.session.expired') {
    application.reconciliationOutcome = 'IGNORED';
    return store.apply(application);
  }

  const subscriptionId = idOf(session.subscription);
  if (!subscriptionId) throw new BillingReconciliationError('CHECKOUT_SUBSCRIPTION_REQUIRED');
  const subscription = await retrieveSubscription(stripe, subscriptionId);
  assertSubscription(
    subscription,
    context,
    config,
    event.type !== 'customer.subscription.deleted',
  );
  attachSubscriptionState(application, subscription, context);
  return store.apply(application);
}

async function reconcileSubscriptionEvent(
  event: Stripe.Event,
  stripe: Stripe,
  store: BillingReconciliationStore,
  config: BillingConfig,
): Promise<ReconciliationApplication> {
  const eventSubscription = event.data.object as Stripe.Subscription;
  let subscription = event.type === 'customer.subscription.deleted'
    ? eventSubscription
    : await retrieveSubscription(stripe, eventSubscription.id);
  const context = await resolveContext(store, idOf(subscription.customer));
  const isTerminalDeletion = event.type === 'customer.subscription.deleted';
  if (isTerminalDeletion && subscription.status !== 'canceled') {
    throw new BillingReconciliationError('SUBSCRIPTION_TERMINAL_STATE_REQUIRED');
  }
  if (isTerminalDeletion && context.selectedOffer === 'SOTF_FOUNDING_FELLOW') {
    subscription = {
      ...subscription,
      discounts: await resolveTerminalSotfDiscounts(stripe, subscription),
    };
  }
  assertSubscription(subscription, context, config, !isTerminalDeletion);
  const application = emptyApplication(event, context, subscription.id);
  attachSubscriptionState(application, subscription, context);
  if (isTerminalDeletion) {
    application.normalizedState = 'CANCELED';
    application.cancelAtPeriodEnd = false;
  }
  if (event.type === 'customer.subscription.trial_will_end') {
    const customer = typeof subscription.customer === 'object'
      ? subscription.customer
      : await stripe.customers.retrieve(subscription.customer);
    const customerHasPaymentMethod = !('deleted' in customer)
      && Boolean(customer.invoice_settings.default_payment_method || customer.default_source);
    application.paymentMethodRequired = !Boolean(
      subscription.default_payment_method
      || subscription.default_source
      || customerHasPaymentMethod,
    );
  }
  return store.apply(application);
}

async function reconcileInvoiceEvent(
  event: Stripe.Event,
  stripe: Stripe,
  store: BillingReconciliationStore,
  config: BillingConfig,
): Promise<ReconciliationApplication> {
  const eventInvoice = event.data.object as Stripe.Invoice;
  const invoice = await stripe.invoices.retrieve(eventInvoice.id, {
    expand: ['lines.data.pricing.price_details.price'],
  });
  const context = await resolveContext(store, idOf(invoice.customer));
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) throw new BillingReconciliationError('INVOICE_SUBSCRIPTION_REQUIRED');
  const subscription = await retrieveSubscription(stripe, subscriptionId);
  assertSubscription(subscription, context, config);
  if (idOf(invoice.customer) !== idOf(subscription.customer)) {
    throw new BillingReconciliationError('INVOICE_CUSTOMER_MISMATCH');
  }

  const prices = invoicePriceIds(invoice);
  const allowedPrices = context.selectedOffer === 'STANDARD_INDIVIDUAL'
    ? new Set([config.monthlyPriceId, config.setupPriceId])
    : new Set([config.monthlyPriceId]);
  if (invoice.currency !== 'usd'
    || !prices.includes(config.monthlyPriceId)
    || prices.some((price) => !allowedPrices.has(price))) {
    throw new BillingReconciliationError('INVOICE_PRICE_MISMATCH');
  }
  const application = emptyApplication(event, context, invoice.id);
  application.stripeSubscriptionId = subscription.id;
  application.invoiceAmountPaid = invoice.amount_paid;
  application.enforceLogicalObjectDedupe = true;

  const currentlyPaid = invoice.status === 'paid';
  if (event.type === 'invoice.paid' && currentlyPaid) {
    const positivePayment = invoice.amount_paid > 0;
    const isInitialStandardSetup = context.selectedOffer === 'STANDARD_INDIVIDUAL'
      && invoice.billing_reason === 'subscription_create'
      && prices.includes(config.setupPriceId)
      && invoice.amount_paid === 19900;
    const isSotfCycle = context.selectedOffer === 'SOTF_FOUNDING_FELLOW'
      && context.sotfQualifyingPaidCycles < 12
      && invoice.billing_reason === 'subscription_cycle'
      && invoice.amount_paid === 1900
      && !prices.includes(config.setupPriceId)
      && hasOnlyExpectedDiscount(subscription, config.sotfCouponId);
    application.setupFeePaidAt = isInitialStandardSetup ? eventIso(event) : null;
    application.qualifyingPaidCycle = isSotfCycle;
    application.clearGrace = positivePayment;
    application.paymentMethodRequired = positivePayment ? false : null;
    attachSubscriptionState(application, subscription, context, positivePayment);
  } else if (currentlyPaid) {
    application.clearGrace = invoice.amount_paid > 0;
    application.paymentMethodRequired = invoice.amount_paid > 0 ? false : null;
    attachSubscriptionState(application, subscription, context, invoice.amount_paid > 0);
  } else if (event.type === 'invoice.payment_failed') {
    const hasPaidHistory = Boolean(context.setupFeePaidAt)
      || context.sotfQualifyingPaidCycles > 0;
    const qualifyingRenewalFailure = invoice.billing_reason === 'subscription_cycle'
      && hasPaidHistory;
    application.startGraceAt = qualifyingRenewalFailure ? eventIso(event) : null;
    application.normalizedState = qualifyingRenewalFailure
      ? 'PAYMENT_GRACE'
      : stateFromSubscription(subscription, context);
    application.paymentMethodRequired = true;
    attachSubscriptionState(application, subscription, context);
    if (qualifyingRenewalFailure) application.normalizedState = 'PAYMENT_GRACE';
  } else {
    attachSubscriptionState(application, subscription, context);
    application.paymentMethodRequired = true;
  }
  return store.apply(application);
}

export async function reconcileStripeEvent(
  event: Stripe.Event,
  dependencies: {
    stripe: Stripe;
    store: BillingReconciliationStore;
    config: BillingConfig;
  },
): Promise<ReconciliationApplication | { applicationResult: 'UNSUPPORTED' }> {
  if (!supportedEventTypes.has(event.type)) return { applicationResult: 'UNSUPPORTED' };
  if (event.type.startsWith('checkout.session.')) {
    return reconcileCheckoutEvent(event, dependencies.stripe, dependencies.store, dependencies.config);
  }
  if (event.type.startsWith('customer.subscription.')) {
    return reconcileSubscriptionEvent(event, dependencies.stripe, dependencies.store, dependencies.config);
  }
  return reconcileInvoiceEvent(event, dependencies.stripe, dependencies.store, dependencies.config);
}
