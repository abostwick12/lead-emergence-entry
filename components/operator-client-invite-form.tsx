'use client';

import { useCallback, useState } from 'react';

type Lifecycle = { identity?: string; personal?: string };
type Client = { admission_ref: string; identity: string; personal: string; lifecycle: string; graph: string; mcp_connections: number };
type Result = { lifecycle?: Lifecycle; clients?: Client[]; personal?: 'active' | 'suspended'; error?: string };

export function OperatorClientInviteForm() {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);

  const send = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/operator/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
    });
    return { ok: response.ok, body: await response.json().catch(() => ({ error: 'REQUEST_UNAVAILABLE' })) as Result };
  }, []);

  const refreshClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const { ok, body } = await send({ action: 'list_personal_clients' });
      if (ok && body.clients) setClients(body.clients);
      setClientsLoaded(true);
    } finally { setLoadingClients(false); }
  }, [send]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setResult(null);
    try {
      const { ok, body } = await send({ action: 'invite_personal', email, display_name: displayName || undefined, idempotency_key: crypto.randomUUID() });
      setResult(body);
      if (ok) { setEmail(''); setDisplayName(''); await refreshClients(); }
    } finally { setBusy(false); }
  }

  async function setAccess(client: Client, status: 'active' | 'suspended') {
    setBusy(true); setResult(null);
    try {
      const { body } = await send({ action: 'set_personal_access', admission_ref: client.admission_ref, status });
      setResult(body); await refreshClients();
    } finally { setBusy(false); }
  }

  return <div style={{ display: 'grid', gap: 28, marginTop: 32, maxWidth: 680 }}>
    <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Display name <span style={{ fontWeight: 400 }}>(optional)</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} /></label>
      <button className="button" disabled={busy} type="submit">{busy ? 'Working…' : 'Invite Personal client'}</button>
    </form>
    {result?.lifecycle && <p role="status">Identity: {result.lifecycle.identity ?? 'pending'} · Personal: {result.lifecycle.personal ?? 'pending'}</p>}
    {result?.personal && <p role="status">Personal access is now {result.personal}.</p>}
    {result?.error && <p role="alert">The client action could not complete. Check the operator verification state and try again.</p>}
    <section aria-labelledby="admitted-clients">
      <h2 id="admitted-clients" className="serif" style={{ fontSize: '1.75rem', fontWeight: 400 }}>Admitted clients</h2>
      <button className="button" type="button" disabled={busy || loadingClients} onClick={() => void refreshClients()}>{loadingClients ? 'Loading…' : 'Refresh lifecycle state'}</button>
      {!clientsLoaded ? <p>Refresh to view admitted-client lifecycle state.</p> : clients.length === 0 ? <p>No client admissions yet.</p> : <div style={{ display: 'grid', gap: 12 }}>
        {clients.map((client, index) => <article key={client.admission_ref} style={{ border: '1px solid var(--sand-dark)', padding: 18 }}>
          <strong>Client {index + 1}</strong>
          <p style={{ margin: '8px 0', lineHeight: 1.6 }}>Identity: {client.identity} · Personal: {client.personal} · Workspace graph: {client.graph} · MCP connections: {client.mcp_connections}</p>
          <button className="button" type="button" disabled={busy} onClick={() => void setAccess(client, client.personal === 'suspended' ? 'active' : 'suspended')}>
            {client.personal === 'suspended' ? 'Reactivate Personal access' : 'Suspend Personal access'}
          </button>
        </article>)}
      </div>}
    </section>
  </div>;
}
