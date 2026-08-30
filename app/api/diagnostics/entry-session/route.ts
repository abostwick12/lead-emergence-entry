import { NextResponse } from 'next/server';
import { entrySessionSubjectFingerprint } from '@/lib/diagnostics/entry-session';
import { getActiveProducts } from '@/lib/identity/server';
import { oauthProductForClient } from '@/lib/oauth/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DenialClass = 'NO_SESSION' | 'NO_PERSONAL_FROM_RPC' | 'CLIENT_UNMAPPED' | 'ELIGIBLE' | 'RPC_ERROR';

type EntrySessionDiagnostic = {
  session_exists: boolean;
  session_subject_fingerprint: string | null;
  personal_from_rpc: boolean;
  workspace_client_configured: boolean;
  workspace_client_maps_to: 'PERSONAL' | 'UNMAPPED';
  denial_class: DenialClass;
};

const noStoreHeaders = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function response(body: EntrySessionDiagnostic) {
  return NextResponse.json(body, { headers: noStoreHeaders });
}

export async function GET() {
  const workspaceClientId = process.env.ENTRY_PERSONAL_OAUTH_CLIENT_ID?.trim() ?? '';
  const workspaceClientConfigured = workspaceClientId.length > 0;
  const workspaceClientMapsTo = workspaceClientConfigured && oauthProductForClient(workspaceClientId) === 'PERSONAL'
    ? 'PERSONAL'
    : 'UNMAPPED';
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return response({
      session_exists: false,
      session_subject_fingerprint: null,
      personal_from_rpc: false,
      workspace_client_configured: workspaceClientConfigured,
      workspace_client_maps_to: workspaceClientMapsTo,
      denial_class: 'NO_SESSION',
    });
  }

  try {
    const activeProducts = await getActiveProducts(supabase);
    const personalFromRpc = activeProducts.includes('PERSONAL');
    const denialClass: DenialClass = workspaceClientMapsTo !== 'PERSONAL'
      ? 'CLIENT_UNMAPPED'
      : personalFromRpc
        ? 'ELIGIBLE'
        : 'NO_PERSONAL_FROM_RPC';

    return response({
      session_exists: true,
      session_subject_fingerprint: entrySessionSubjectFingerprint(data.user.id),
      personal_from_rpc: personalFromRpc,
      workspace_client_configured: workspaceClientConfigured,
      workspace_client_maps_to: workspaceClientMapsTo,
      denial_class: denialClass,
    });
  } catch {
    return response({
      session_exists: true,
      session_subject_fingerprint: entrySessionSubjectFingerprint(data.user.id),
      personal_from_rpc: false,
      workspace_client_configured: workspaceClientConfigured,
      workspace_client_maps_to: workspaceClientMapsTo,
      denial_class: 'RPC_ERROR',
    });
  }
}
