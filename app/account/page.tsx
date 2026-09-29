import Link from 'next/link';
import { createEntryBillingLifecycleStore } from '@/lib/billing/store';
import { requireCanonicalIdentity } from '@/lib/identity/server';
import { PRODUCTS, PRODUCT_COPY } from '@/lib/identity/products';

export default async function AccountPage() {
  const { user } = await requireCanonicalIdentity('/account');
  const billing = await createEntryBillingLifecycleStore().resolveByCanonicalUser(user.id);
  const hasBillingRelationship = Boolean(
    billing?.stripeCustomerId && billing.stripeSubscriptionId,
  );
  const canRequestResume = billing?.selectedOffer === 'SOTF_FOUNDING_FELLOW'
    && billing.normalizedState === 'PAUSED_NO_PAYMENT_METHOD'
    && hasBillingRelationship;

  return <main><div className="shell" style={{padding:'48px 0'}}><header style={{display:'flex',justifyContent:'space-between'}}><Link href="/workspaces" className="eyebrow">Lead Emergence</Link><Link href="/workspaces">Workspaces</Link></header><section style={{maxWidth:680,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Canonical account</p><h1 className="serif" style={{fontSize:'clamp(2.4rem, 6vw, 4rem)',fontWeight:400}}>Account settings</h1><div style={{display:'grid',gap:14,marginTop:36}}><section style={{borderTop:'1px solid #d9d1c3',padding:'20px 0'}}><h2>Profile</h2><p>Your canonical Lead Emergence identity.</p></section><section style={{borderTop:'1px solid #d9d1c3',padding:'20px 0'}}><h2>Email & authentication</h2><p>Managed by the dedicated Lead Emergence identity project.</p></section><section style={{borderTop:'1px solid #d9d1c3',padding:'20px 0'}}><h2>Product access</h2>{PRODUCTS.map((product) => <p key={product}>{PRODUCT_COPY[product].name} — <strong>Access managed separately</strong></p>)}</section><section style={{borderTop:'1px solid #d9d1c3',padding:'20px 0'}}><h2>Billing</h2>{hasBillingRelationship ? <><p>Stripe securely manages payment methods, invoices, and period-end cancellation. Returning here does not change access until Stripe confirms payment.</p><div style={{display:'flex',flexWrap:'wrap',gap:12}}><form action="/api/billing/portal" method="post"><button className="button secondary" type="submit">Manage billing</button></form><form action="/api/billing/portal" method="post"><button className="button secondary" type="submit">Update payment method</button></form>{canRequestResume ? <form action="/api/billing/resume" method="post"><button className="button" type="submit">Resume subscription</button></form> : null}</div></> : <p>No customer-managed Stripe billing relationship is attached to this account.</p>}</section></div><Link className="button secondary" href="/">Sign out</Link></section></div></main>;
}
