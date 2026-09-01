import 'server-only';

import { oauthProductForClient, type OAuthProduct } from '@/lib/oauth/server';
import { recordMcpOAuthAdmissionEvent, resolveMcpOAuthAdmission, type McpOAuthAdmission } from '@/lib/oauth/mcp-admission';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

type EntryServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type OAuthRequestClassification =
  | { kind: 'PRODUCT_HANDOFF'; product: OAuthProduct; mcp: null }
  | { kind: 'WORKSPACE_MCP'; product: 'PERSONAL'; mcp: McpOAuthAdmission }
  | { kind: 'DENY'; product: null; mcp: McpOAuthAdmission };

export async function classifyOAuthRequest(
  supabase: EntryServerClient,
  authorizationId: string,
  clientId?: string,
): Promise<OAuthRequestClassification> {
  if (clientId) {
    const product = oauthProductForClient(clientId);
    if (product) return { kind: 'PRODUCT_HANDOFF', product, mcp: null };
  }

  const mcp = await resolveMcpOAuthAdmission(supabase, authorizationId);
  await recordMcpOAuthAdmissionEvent(supabase, authorizationId, 'request_classified', mcp.denial_code);
  if (mcp.request_class === 'WORKSPACE_MCP') return { kind: 'WORKSPACE_MCP', product: 'PERSONAL', mcp };
  return { kind: 'DENY', product: null, mcp };
}
