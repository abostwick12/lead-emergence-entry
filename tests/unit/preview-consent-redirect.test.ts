import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entryOrigin = 'https://lead-emergence-entry-dev.vercel.app';
const workspaceOrigin = 'https://lead-emergence-workspace-git-codex-p2-bf4902-emergence-projects.vercel.app';
const previewCallback = `${workspaceOrigin}/auth/callback/sign-in`;
const previewClientId = '4988caf7-8d41-4d5f-8ed1-9a88841b692a';
const authorizationId = '00000000-0000-4000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  getActiveProducts: vi.fn(),
  ensureAutomaticPersonalEntitlement: vi.fn(),
  resolveMcpOAuthAdmission: vi.fn(),
  recordMcpOAuthAdmissionEvent: vi.fn(),
  activateMcpOAuthGrant: vi.fn(),
  redirect: vi.fn(),
  getUser: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/identity/server', () => ({ getActiveProducts: mocks.getActiveProducts }));
vi.mock('@/lib/identity/automatic-personal', () => ({
  ensureAutomaticPersonalEntitlement: mocks.ensureAutomaticPersonalEntitlement,
}));
vi.mock('@/lib/oauth/mcp-admission', () => ({
  resolveMcpOAuthAdmission: mocks.resolveMcpOAuthAdmission,
  recordMcpOAuthAdmissionEvent: mocks.recordMcpOAuthAdmissionEvent,
  activateMcpOAuthGrant: mocks.activateMcpOAuthGrant,
}));

import OAuthConsentPage from '@/app/oauth/consent/page';
import { POST } from '@/app/api/oauth/decision/route';
import { oauthProductForRedirect, safeProductOAuthRedirect } from '@/lib/oauth/server';

function decisionRequest(decision = 'approve') {
  return new Request(`${entryOrigin}/api/oauth/decision`, {
    method: 'POST',
    headers: { origin: entryOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ authorization_id: authorizationId, decision }),
  });
}

function authorizationDetails(clientId: string) {
  return { data: { authorization_id: authorizationId, client: { id: clientId }, redirect_url: previewCallback }, error: null };
}

describe('Entry Preview first-party consent redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('APP_ORIGIN', entryOrigin);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://vnjdubrnmxvmsccxmhst.supabase.co');
    vi.stubEnv('ENTRY_PERSONAL_OAUTH_CLIENT_ID', previewClientId);
    vi.stubEnv('ENTRY_PERSONAL_OAUTH_REDIRECT_ORIGIN', workspaceOrigin);
    vi.stubEnv('ENTRY_CONSULTING_OAUTH_CLIENT_ID', 'consulting-client');
    vi.stubEnv('ENTRY_CONSULTING_OAUTH_REDIRECT_ORIGIN', 'https://consulting-auth.example.test');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.getActiveProducts.mockResolvedValue(['PERSONAL', 'CONSULTING']);
    mocks.ensureAutomaticPersonalEntitlement.mockResolvedValue(true);
    mocks.getAuthorizationDetails.mockResolvedValue(authorizationDetails(previewClientId));
    mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: `${previewCallback}?code=approved&state=opaque` }, error: null });
    mocks.denyAuthorization.mockResolvedValue({ data: { redirect_url: `${previewCallback}?error=access_denied&state=opaque` }, error: null });
    mocks.resolveMcpOAuthAdmission.mockResolvedValue({ request_class: 'DENY', denial_code: 'UNKNOWN_CLIENT' });
    mocks.activateMcpOAuthGrant.mockResolvedValue(true);
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: {
      getUser: mocks.getUser,
      oauth: {
        getAuthorizationDetails: mocks.getAuthorizationDetails,
        approveAuthorization: mocks.approveAuthorization,
        denyAuthorization: mocks.denyAuthorization,
      },
    } });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns an approved new-client response only to the exact Workspace callback', async () => {
    const response = await POST(decisionRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${previewCallback}?code=approved&state=opaque`);
    expect(mocks.approveAuthorization).toHaveBeenCalledOnce();
    expect(mocks.resolveMcpOAuthAdmission).not.toHaveBeenCalled();
  });

  it('handles a remembered grant at that same callback', async () => {
    const destination = `${previewCallback}?code=remembered&state=opaque`;
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: destination }, error: null });
    mocks.redirect.mockImplementation(() => { throw new Error('redirected'); });
    await expect(OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: authorizationId }) }))
      .rejects.toThrow('redirected');
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledWith({ id: 'user-1' }, 'PERSONAL');
  });

  it('rejects other origins, paths, queries and incomplete Preview binding', () => {
    for (const destination of [
      `https://other.example.test/auth/callback/sign-in?code=ok`,
      `${workspaceOrigin}/auth/v1/callback?code=ok`,
      `${workspaceOrigin}/auth/callback/other?code=ok`,
      `${previewCallback}?code=ok&next=https://other.example.test`,
    ]) {
      expect(safeProductOAuthRedirect(destination, 'PERSONAL')).toBeNull();
      expect(oauthProductForRedirect(destination)).toBeNull();
    }
    vi.stubEnv('APP_ORIGIN', 'https://entry.leademergence.com');
    expect(safeProductOAuthRedirect(`${previewCallback}?code=ok`, 'PERSONAL')).toBeNull();
  });

  it('preserves legacy product callbacks outside the pinned Preview client', async () => {
    vi.stubEnv('ENTRY_PERSONAL_OAUTH_CLIENT_ID', 'legacy-personal-client');
    vi.stubEnv('ENTRY_PERSONAL_OAUTH_REDIRECT_ORIGIN', 'https://personal-auth.example.test');
    const legacyCallback = 'https://personal-auth.example.test/auth/v1/callback?code=approved';
    mocks.getAuthorizationDetails.mockResolvedValue(authorizationDetails('legacy-personal-client'));
    mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: legacyCallback }, error: null });
    const response = await POST(decisionRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(legacyCallback);
    expect(oauthProductForRedirect(legacyCallback)).toBe('PERSONAL');
    expect(safeProductOAuthRedirect(`${previewCallback}?code=ok`, 'PERSONAL')).toBeNull();
  });

  it('preserves exact MCP admission and denies an unclassified client', async () => {
    const registered = 'http://127.0.0.1:49321/callback?channel=desktop';
    mocks.getAuthorizationDetails.mockResolvedValue(authorizationDetails('mcp-client'));
    mocks.resolveMcpOAuthAdmission.mockResolvedValueOnce({
      request_class: 'WORKSPACE_MCP', denial_code: null,
      expected_redirect_uri: registered, grant_active: false,
    });
    mocks.approveAuthorization.mockResolvedValueOnce({
      data: { redirect_url: `${registered}&code=approved&state=opaque` }, error: null,
    });
    const mcp = await POST(decisionRequest());
    expect(mcp.status).toBe(303);
    expect(mcp.headers.get('location')).toBe(`${registered}&code=approved&state=opaque`);
    expect(mocks.activateMcpOAuthGrant).toHaveBeenCalledOnce();

    mocks.approveAuthorization.mockClear();
    mocks.getAuthorizationDetails.mockResolvedValue(authorizationDetails('unknown-client'));
    const denied = await POST(decisionRequest());
    expect(denied.status).toBe(400);
    expect(mocks.approveAuthorization).not.toHaveBeenCalled();
    expect(mocks.denyAuthorization).toHaveBeenCalledOnce();
  });
});
