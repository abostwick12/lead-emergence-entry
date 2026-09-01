import 'server-only';

import type { createSupabaseServerClient } from '@/lib/supabase/server';

export type McpOAuthAdmission = {
  request_class: 'WORKSPACE_MCP' | 'DENY';
  denial_code: string;
  expected_redirect_uri: string | null;
  requested_scopes: string[];
  grant_active: boolean;
};

type EntryServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function resolveMcpOAuthAdmission(supabase: EntryServerClient, authorizationId: string): Promise<McpOAuthAdmission> {
  const { data, error } = await supabase
    .schema('workspace')
    .rpc('resolve_mcp_oauth_authorization', { p_authorization_id: authorizationId });

  const candidate = Array.isArray(data) ? data[0] : data;
  const result = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : null;
  if (error || !result || result.request_class !== 'WORKSPACE_MCP') {
    return {
      request_class: 'DENY',
      denial_code: typeof result?.denial_code === 'string' ? result.denial_code : 'REQUEST_UNAVAILABLE',
      expected_redirect_uri: null,
      requested_scopes: [],
      grant_active: false,
    };
  }

  return {
    request_class: 'WORKSPACE_MCP',
    denial_code: typeof result.denial_code === 'string' ? result.denial_code : 'ELIGIBLE',
    expected_redirect_uri: typeof result.expected_redirect_uri === 'string' ? result.expected_redirect_uri : null,
    requested_scopes: Array.isArray(result.requested_scopes) ? result.requested_scopes.filter((scope: unknown): scope is string => typeof scope === 'string') : [],
    grant_active: result.grant_active === true,
  };
}

export async function activateMcpOAuthGrant(supabase: EntryServerClient, authorizationId: string) {
  const { data, error } = await supabase
    .schema('workspace')
    .rpc('activate_mcp_oauth_grant', { p_authorization_id: authorizationId });
  return !error && Boolean(data);
}

export async function recordMcpOAuthAdmissionEvent(
  supabase: EntryServerClient,
  authorizationId: string,
  eventType: 'request_classified' | 'authorization_denied',
  reasonCode: string,
) {
  await supabase
    .schema('workspace')
    .rpc('record_mcp_oauth_authorization_event', {
      p_authorization_id: authorizationId,
      p_event_type: eventType,
      p_reason_code: reasonCode,
    });
}
