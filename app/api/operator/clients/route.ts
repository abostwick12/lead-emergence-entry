import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isTrustedOAuthFormOrigin } from '@/lib/oauth/contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isTrustedOAuthFormOrigin(request.url, request.headers.get('origin'), process.env.APP_ORIGIN)) {
    return json({ error: 'REQUEST_FORBIDDEN' }, 403);
  }
  const payload = await request.json().catch(() => null);
  if (!isOperatorPayload(payload)) return json({ error: 'REQUEST_INVALID' }, 400);

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (userError || !userData.user || sessionError || !sessionData.session?.access_token) return json({ error: 'OPERATOR_AUTH_REQUIRED' }, 401);
  const operator = await supabase.rpc('get_my_entry_operator_status');
  if (operator.error || operator.data !== true) return json({ error: 'OPERATOR_AUTH_REQUIRED' }, 403);

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/operator-clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({ error: 'OPERATOR_SERVICE_UNAVAILABLE' }));
  return json(sanitizeOperatorResponse(body), response.status);
}

type OperatorPayload =
  | { action: 'invite_personal'; email: string; display_name?: string; idempotency_key: string }
  | { action: 'list_personal_clients' }
  | { action: 'set_personal_access'; admission_ref: string; status: 'active' | 'suspended' };

function isOperatorPayload(value: unknown): value is OperatorPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  if (payload.action === 'list_personal_clients') return true;
  if (payload.action === 'set_personal_access') return typeof payload.admission_ref === 'string' && /^[a-f0-9]{16}$/.test(payload.admission_ref)
    && (payload.status === 'active' || payload.status === 'suspended');
  return payload.action === 'invite_personal' && typeof payload.email === 'string' && payload.email.length <= 254
    && (payload.display_name === undefined || typeof payload.display_name === 'string')
    && typeof payload.idempotency_key === 'string' && payload.idempotency_key.length === 36;
}

function sanitizeOperatorResponse(value: unknown) {
  if (!value || typeof value !== 'object') return { error: 'OPERATOR_SERVICE_UNAVAILABLE' };
  const payload = value as Record<string, unknown>;
  const lifecycle = payload.lifecycle;
  if (lifecycle && typeof lifecycle === 'object') {
    const data = lifecycle as Record<string, unknown>;
    return { lifecycle: { identity: typeof data.identity === 'string' ? data.identity : 'pending', personal: typeof data.personal === 'string' ? data.personal : 'pending' } };
  }
  if (Array.isArray(payload.clients)) {
    return { clients: payload.clients.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const client = value as Record<string, unknown>;
      if (typeof client.admission_ref !== 'string' || !/^[a-f0-9]{16}$/.test(client.admission_ref)) return [];
      return [{ admission_ref: client.admission_ref, identity: state(client.identity), personal: state(client.personal), lifecycle: state(client.lifecycle), graph: state(client.graph), mcp_connections: typeof client.mcp_connections === 'number' && Number.isInteger(client.mcp_connections) && client.mcp_connections >= 0 ? client.mcp_connections : 0 }];
    }) };
  }
  if (payload.personal === 'active' || payload.personal === 'suspended') return { personal: payload.personal };
  return { error: typeof payload.error === 'string' ? payload.error : 'OPERATOR_SERVICE_UNAVAILABLE' };
}

function state(value: unknown) { return typeof value === 'string' && /^[a-z_]+$/i.test(value) ? value : 'unavailable'; }

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
