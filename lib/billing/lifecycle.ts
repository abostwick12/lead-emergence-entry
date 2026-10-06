import 'server-only';

import type Stripe from 'stripe';
import type { BillingConfig } from '@/lib/billing/config';
import type {
  BillingLifecycleContext,
  BillingLifecycleStore,
  SotfDiscountRemovalCandidate,
} from '@/lib/billing/store';

export class BillingLifecycleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function idOf(value: { id: string } | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function subscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  return subscription.items.data.map((item) => item.price.id).sort();
}

type ExpandableDiscount = string | Stripe.Discount | Stripe.DeletedDiscount;

function discountCouponId(discount: ExpandableDiscount): string | null {
  if (typeof discount === 'string' || discount.deleted) return null;
  return idOf(discount.source?.coupon);
}

function assertOwnedSotfSubscription(
  subscription: Stripe.Subscription,
  ownership: {
    canonicalUserId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
  config: BillingConfig,
) {
  if (subscription.id !== ownership.stripeSubscriptionId
    || idOf(subscription.customer) !== ownership.stripeCustomerId) {
    throw new BillingLifecycleError('SUBSCRIPTION_OWNERSHIP_MISMATCH', 409);
  }
  if (subscription.metadata.canonical_user_id !== ownership.canonicalUserId
    || subscription.metadata.commercial_offer !== 'SOTF_FOUNDING_FELLOW') {
    throw new BillingLifecycleError('STRIPE_METADATA_CONTRADICTION', 409);
  }
  const prices = subscriptionPriceIds(subscription);
  if (prices.length !== 1 || prices[0] !== config.monthlyPriceId) {
    throw new BillingLifecycleError('SUBSCRIPTION_PRICE_MISMATCH', 409);
  }
}

function assertCanonicalSotfResumptionInvoice(
  invoice: Stripe.Invoice,
  expectedInvoiceId: string,
  ownership: {
    canonicalUserId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  },
  config: BillingConfig,
) {
  if (invoice.id !== expectedInvoiceId
    || idOf(invoice.customer) !== ownership.stripeCustomerId) {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_OWNERSHIP_MISMATCH', 409);
  }

  const subscriptionDetails = invoice.parent?.type === 'subscription_details'
    ? invoice.parent.subscription_details
    : null;
  if (!subscriptionDetails
    || idOf(subscriptionDetails.subscription) !== ownership.stripeSubscriptionId
    || subscriptionDetails.metadata?.canonical_user_id !== ownership.canonicalUserId
    || subscriptionDetails.metadata?.commercial_offer !== 'SOTF_FOUNDING_FELLOW') {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_RELATIONSHIP_MISMATCH', 409);
  }

  if (invoice.status !== 'open' && invoice.status !== 'paid') {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_NOT_PAYABLE', 409);
  }

  const invoiceDiscount = invoice.discounts.length === 1 ? invoice.discounts[0] : null;
  const invoiceDiscountId = idOf(invoiceDiscount);
  const totalDiscount = invoice.total_discount_amounts;
  const line = invoice.lines.data.length === 1 && !invoice.lines.has_more
    ? invoice.lines.data[0]
    : null;
  const lineSubscriptionDetails = line?.parent?.type === 'subscription_item_details'
    ? line.parent.subscription_item_details
    : null;
  const lineDiscount = line?.discount_amounts?.length === 1
    ? line.discount_amounts[0]
    : null;

  if (invoice.collection_method !== 'charge_automatically'
    || invoice.currency !== 'usd'
    || invoice.billing_reason !== 'subscription_cycle'
    || invoice.amount_due !== 1900
    || invoice.subtotal !== 3900
    || invoice.subtotal_excluding_tax !== 3900
    || invoice.total !== 1900
    || invoice.total_excluding_tax !== 1900
    || invoice.amount_shipping !== 0
    || invoice.starting_balance !== 0
    || invoice.pre_payment_credit_notes_amount !== 0
    || invoice.post_payment_credit_notes_amount !== 0
    || (invoice.total_taxes?.length ?? 0) !== 0
    || !invoiceDiscount
    || !invoiceDiscountId
    || discountCouponId(invoiceDiscount) !== config.sotfCouponId
    || totalDiscount?.length !== 1
    || totalDiscount[0].amount !== 2000
    || idOf(totalDiscount[0].discount) !== invoiceDiscountId
    || !line
    || line.currency !== 'usd'
    || line.amount !== 3900
    || line.subtotal !== 3900
    || line.quantity !== 1
    || line.pricing?.type !== 'price_details'
    || idOf(line.pricing.price_details?.price) !== config.monthlyPriceId
    || idOf(line.pricing.price_details?.price) === config.setupPriceId
    || !lineSubscriptionDetails
    || lineSubscriptionDetails.proration
    || idOf(lineSubscriptionDetails.subscription) !== ownership.stripeSubscriptionId
    || lineDiscount?.amount !== 2000
    || idOf(lineDiscount.discount) !== invoiceDiscountId
    || (line.taxes?.length ?? 0) !== 0) {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_CONTRACT_MISMATCH', 409);
  }

  if (invoice.status === 'open'
    && (invoice.amount_paid !== 0 || invoice.amount_remaining !== 1900)) {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_CONTRACT_MISMATCH', 409);
  }
  if (invoice.status === 'paid'
    && (!invoice.attempted || invoice.amount_paid !== 1900 || invoice.amount_remaining !== 0)) {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_CONTRACT_MISMATCH', 409);
  }
}

function requireBillingRelationship(
  context: BillingLifecycleContext | null,
): asserts context is BillingLifecycleContext & {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
} {
  if (!context?.stripeCustomerId || !context.stripeSubscriptionId) {
    throw new BillingLifecycleError('BILLING_RELATIONSHIP_REQUIRED', 403);
  }
}

function assertPortalPolicy(configuration: Stripe.BillingPortal.Configuration) {
  const features = configuration.features;
  if (!configuration.active
    || !features.payment_method_update.enabled
    || !features.invoice_history.enabled
    || !features.subscription_cancel.enabled
    || features.subscription_cancel.mode !== 'at_period_end'
    || features.subscription_cancel.proration_behavior !== 'none'
    || features.subscription_update.enabled
    || features.customer_update.enabled) {
    throw new BillingLifecycleError('PORTAL_CONFIGURATION_POLICY_MISMATCH', 503);
  }
}

export async function createPortalSessionForUser(
  canonicalUserId: string,
  dependencies: {
    stripe: Stripe;
    store: BillingLifecycleStore;
    config: BillingConfig;
  },
): Promise<{ url: string }> {
  const context = await dependencies.store.resolveByCanonicalUser(canonicalUserId);
  requireBillingRelationship(context);

  const portalConfiguration = await dependencies.stripe.billingPortal.configurations.retrieve(
    dependencies.config.portalConfigurationId,
  );
  assertPortalPolicy(portalConfiguration);

  const session = await dependencies.stripe.billingPortal.sessions.create({
    customer: context.stripeCustomerId,
    configuration: dependencies.config.portalConfigurationId,
    return_url: `${dependencies.config.entryOrigin}/account?billing=portal-return`,
  });
  return { url: session.url };
}

async function expandedCustomer(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<Stripe.Customer | Stripe.DeletedCustomer> {
  if (typeof subscription.customer === 'object') return subscription.customer;
  return stripe.customers.retrieve(subscription.customer);
}

function hasUsablePaymentMethod(
  subscription: Stripe.Subscription,
  customer: Stripe.Customer | Stripe.DeletedCustomer,
): boolean {
  if ('deleted' in customer) return false;
  return Boolean(
    idOf(subscription.default_payment_method)
    || idOf(subscription.default_source)
    || idOf(customer.invoice_settings.default_payment_method)
    || idOf(customer.default_source),
  );
}

export async function resumeSotfSubscriptionForUser(
  canonicalUserId: string,
  dependencies: {
    stripe: Stripe;
    store: BillingLifecycleStore;
    config: BillingConfig;
  },
): Promise<{ disposition: 'RESUME_REQUESTED' | 'ALREADY_RESUMED' }> {
  const context = await dependencies.store.resolveByCanonicalUser(canonicalUserId);
  requireBillingRelationship(context);
  if (context.selectedOffer !== 'SOTF_FOUNDING_FELLOW'
    || context.normalizedState !== 'PAUSED_NO_PAYMENT_METHOD') {
    throw new BillingLifecycleError('SOTF_PAUSED_SUBSCRIPTION_REQUIRED', 409);
  }

  const subscription = await dependencies.stripe.subscriptions.retrieve(
    context.stripeSubscriptionId,
    { expand: ['customer', 'discounts'] },
  );
  assertOwnedSotfSubscription(subscription, context, dependencies.config);

  if (subscription.status === 'active' || subscription.status === 'trialing') {
    return { disposition: 'ALREADY_RESUMED' };
  }
  if (subscription.status !== 'paused') {
    throw new BillingLifecycleError('SUBSCRIPTION_NOT_RESUMABLE', 409);
  }
  if (subscription.collection_method !== 'charge_automatically') {
    throw new BillingLifecycleError('SUBSCRIPTION_COLLECTION_METHOD_MISMATCH', 409);
  }
  const customer = await expandedCustomer(dependencies.stripe, subscription);
  if (!hasUsablePaymentMethod(subscription, customer)) {
    throw new BillingLifecycleError('USABLE_PAYMENT_METHOD_REQUIRED', 409);
  }

  const resumeParams: Stripe.SubscriptionResumeParams = {
    billing_cycle_anchor: 'now',
    proration_behavior: 'none',
  };
  const resumedSubscription = await dependencies.stripe.subscriptions.resume(
    context.stripeSubscriptionId,
    resumeParams,
    { idempotencyKey: `resume-sotf-${context.canonicalUserId}-${context.stripeSubscriptionId}` },
  );
  assertOwnedSotfSubscription(resumedSubscription, context, dependencies.config);

  const resumptionInvoiceId = idOf(resumedSubscription.latest_invoice);
  if (!resumptionInvoiceId) {
    throw new BillingLifecycleError('RESUMPTION_INVOICE_REQUIRED', 409);
  }
  const resumptionInvoice = await dependencies.stripe.invoices.retrieve(
    resumptionInvoiceId,
    { expand: ['discounts'] },
  );
  assertCanonicalSotfResumptionInvoice(
    resumptionInvoice,
    resumptionInvoiceId,
    context,
    dependencies.config,
  );

  if (resumptionInvoice.status === 'paid') {
    return { disposition: 'ALREADY_RESUMED' };
  }

  let paidInvoice: Stripe.Invoice;
  try {
    paidInvoice = await dependencies.stripe.invoices.pay(
      resumptionInvoice.id,
      { expand: ['discounts'] },
      {
        idempotencyKey:
          `pay-sotf-resumption-${context.canonicalUserId}-${context.stripeSubscriptionId}-${resumptionInvoice.id}`,
      },
    );
  } catch {
    throw new BillingLifecycleError('SOTF_RESUMPTION_PAYMENT_FAILED', 402);
  }
  assertCanonicalSotfResumptionInvoice(
    paidInvoice,
    resumptionInvoiceId,
    context,
    dependencies.config,
  );
  if (paidInvoice.status !== 'paid'
    || !paidInvoice.attempted
    || paidInvoice.amount_paid !== 1900) {
    throw new BillingLifecycleError('SOTF_RESUMPTION_PAYMENT_FAILED', 402);
  }
  return { disposition: 'RESUME_REQUESTED' };
}

async function completeOneDiscountRemoval(
  candidate: Omit<SotfDiscountRemovalCandidate, 'discountRemovalAttemptCount'>,
  dependencies: {
    stripe: Stripe;
    store: BillingLifecycleStore;
    config: BillingConfig;
  },
): Promise<void> {
  try {
    if (candidate.sotfQualifyingPaidCycles !== 12) {
      throw new BillingLifecycleError('DISCOUNT_REMOVAL_NOT_DUE', 409);
    }
    const subscription = await dependencies.stripe.subscriptions.retrieve(
      candidate.stripeSubscriptionId,
      { expand: ['customer', 'discounts'] },
    );
    assertOwnedSotfSubscription(subscription, candidate, dependencies.config);

    if (subscription.discounts.length === 0) {
      await dependencies.store.recordDiscountRemovalAttempt({
        canonicalUserId: candidate.canonicalUserId,
        succeeded: true,
        errorCode: null,
      });
      return;
    }

    const hasExpectedFoundingDiscount = subscription.discounts.length === 1
      && discountCouponId(subscription.discounts[0]) === dependencies.config.sotfCouponId;
    if (!hasExpectedFoundingDiscount) {
      throw new BillingLifecycleError('UNEXPECTED_SUBSCRIPTION_DISCOUNT', 409);
    }

    const updated = await dependencies.stripe.subscriptions.update(
      candidate.stripeSubscriptionId,
      { discounts: '', proration_behavior: 'none' },
      { idempotencyKey: `remove-sotf-discount-${candidate.canonicalUserId}` },
    );
    if (updated.discounts.length !== 0) {
      throw new BillingLifecycleError('FOUNDING_DISCOUNT_STILL_ATTACHED', 409);
    }
    await dependencies.store.recordDiscountRemovalAttempt({
      canonicalUserId: candidate.canonicalUserId,
      succeeded: true,
      errorCode: null,
    });
  } catch (error) {
    const errorCode = error instanceof BillingLifecycleError
      ? error.code
      : 'STRIPE_DISCOUNT_REMOVAL_FAILED';
    try {
      await dependencies.store.recordDiscountRemovalAttempt({
        canonicalUserId: candidate.canonicalUserId,
        succeeded: false,
        errorCode,
      });
    } catch {
      throw new BillingLifecycleError('DISCOUNT_REMOVAL_EVIDENCE_FAILED', 503);
    }
    throw new BillingLifecycleError(errorCode, 503);
  }
}

export async function drainPendingSotfDiscountRemovals(
  dependencies: {
    stripe: Stripe;
    store: BillingLifecycleStore;
    config: BillingConfig;
    canonicalUserId?: string;
  },
  limit = 5,
): Promise<{ attempted: number; succeeded: number; failed: number; errorCodes: string[] }> {
  const pending: Omit<SotfDiscountRemovalCandidate, 'discountRemovalAttemptCount'>[] = [];
  if (dependencies.canonicalUserId !== undefined) {
    const context = await dependencies.store.resolveByCanonicalUser(dependencies.canonicalUserId);
    if (!context || context.canonicalUserId !== dependencies.canonicalUserId) {
      throw new BillingLifecycleError('DISCOUNT_REMOVAL_OWNERSHIP_MISMATCH', 503);
    }
    // Match the existing pending-removal predicate, scoped to the reconciled
    // account so another account cannot consume this event's retries.
    if (context.selectedOffer === 'SOTF_FOUNDING_FELLOW'
      && context.sotfQualifyingPaidCycles === 12
      && context.discountRemovalDue
      && context.discountRemovedAt === null
      && context.stripeCustomerId !== null
      && context.stripeSubscriptionId !== null) {
      pending.push({
        canonicalUserId: context.canonicalUserId,
        stripeCustomerId: context.stripeCustomerId,
        stripeSubscriptionId: context.stripeSubscriptionId,
        sotfQualifyingPaidCycles: context.sotfQualifyingPaidCycles,
      });
    }
  } else {
    pending.push(...await dependencies.store.listPendingDiscountRemovals(limit));
  }
  let succeeded = 0;
  const errorCodes: string[] = [];
  for (const candidate of pending) {
    try {
      await completeOneDiscountRemoval(candidate, dependencies);
      succeeded += 1;
    } catch (error) {
      errorCodes.push(error instanceof BillingLifecycleError
        ? error.code
        : 'DISCOUNT_REMOVAL_FAILED');
    }
  }
  return {
    attempted: pending.length,
    succeeded,
    failed: pending.length - succeeded,
    errorCodes,
  };
}
