import { NextResponse } from 'next/server';
import { getBillingConfig, getStripeWebhookSecret } from '@/lib/billing/config';
import { reconcileStripeEvent, BillingReconciliationError } from '@/lib/billing/reconciliation';
import {
  createEntryBillingLifecycleStore,
  createEntryBillingReconciliationStore,
} from '@/lib/billing/store';
import { getStripeClient } from '@/lib/billing/stripe';
import { drainConfiguredPersonalProjectionOutbox } from '@/lib/billing/projection';
import { drainPendingSotfDiscountRemovals } from '@/lib/billing/lifecycle';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripeClient();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch {
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 });
  }

  try {
    const config = getBillingConfig();
    const result = await reconcileStripeEvent(event, {
      stripe,
      store: createEntryBillingReconciliationStore(),
      config,
    });
    let discountRemovalFailed = false;
    try {
      const discountRemoval = await drainPendingSotfDiscountRemovals({
        stripe,
        store: createEntryBillingLifecycleStore(),
        config,
      });
      if (discountRemoval.failed > 0) {
        discountRemovalFailed = true;
        console.error('SOTF discount removal remains pending', {
          failedCount: discountRemoval.failed,
          reasons: discountRemoval.errorCodes,
        });
      }
    } catch {
      discountRemovalFailed = true;
      console.error('SOTF discount removal unavailable');
    }
    try {
      const delivery = await drainConfiguredPersonalProjectionOutbox();
      if (delivery.failed > 0) {
        console.error('Workspace projection delivery remains pending', {
          failedCount: delivery.failed,
        });
      }
    } catch {
      // Canonical reconciliation has already committed. Delivery is retained in
      // the transactional outbox and must never turn that truth into a failure.
      console.error('Workspace projection delivery unavailable');
    }
    if (discountRemovalFailed) {
      return NextResponse.json({ error: 'SOTF discount removal pending' }, { status: 503 });
    }
    return NextResponse.json({ received: true, result: result.applicationResult });
  } catch (error) {
    if (error instanceof BillingReconciliationError) {
      console.error('Stripe reconciliation rejected', {
        eventId: event.id,
        eventType: event.type,
        reason: error.code,
      });
      if (error.code === 'CHECKOUT_OWNERSHIP_MISMATCH'
        && event.type === 'checkout.session.expired') {
        return NextResponse.json({ received: true, result: 'IGNORED' });
      }
      return NextResponse.json({ error: error.code }, { status: 400 });
    }
    console.error('Stripe reconciliation failed', {
      eventId: event.id,
      eventType: event.type,
    });
    return NextResponse.json({ error: 'Reconciliation unavailable' }, { status: 503 });
  }
}
