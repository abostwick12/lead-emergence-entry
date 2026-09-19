import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireCanonicalIdentity } from '@/lib/identity/server';
import { OperatorClientInviteForm } from '@/components/operator-client-invite-form';

export const dynamic = 'force-dynamic';

export default async function OperatorClientsPage() {
  const { supabase } = await requireCanonicalIdentity('/operator/clients');
  const { data: operator, error } = await supabase.rpc('get_my_entry_operator_status');
  if (error || operator !== true) notFound();

  return <main><div className="shell" style={{ padding: '48px 0' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between' }}>
      <Link href="/workspaces" className="eyebrow">Lead Emergence</Link>
      <Link href="/account">Account</Link>
    </header>
    <section style={{ maxWidth: 680, margin: '10vh auto' }}>
      <p className="eyebrow" style={{ color: 'var(--teal)' }}>Owner console</p>
      <h1 className="serif" style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 400 }}>Invite a Personal client</h1>
      <p style={{ lineHeight: 1.7 }}>Invite-only admission creates or reuses one canonical Lead Emergence identity, activates Personal access through the audited Entry command, and leaves the first Workspace graph to trusted Workspace provisioning.</p>
      <p style={{ lineHeight: 1.7, fontSize: '.92rem' }}>This action requires a current two-step-verification session. The console never displays credentials, contact details, tokens, or Workspace content.</p>
      <OperatorClientInviteForm />
    </section>
  </div></main>;
}
