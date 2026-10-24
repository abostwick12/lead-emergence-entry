import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOAuthEntryUser: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  ensureAutomaticPersonalEntitlement: vi.fn(),
  canAuthorizeProduct: vi.fn(),
  classifyOAuthRequest: vi.fn(),
  oauthProductForRedirect: vi.fn(),
  oauthRedirectOrigin: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/identity/automatic-personal', () => ({
  ensureAutomaticPersonalEntitlement: mocks.ensureAutomaticPersonalEntitlement,
}));
vi.mock('@/lib/oauth/server', () => ({
  requireOAuthEntryUser: mocks.requireOAuthEntryUser,
  canAuthorizeProduct: mocks.canAuthorizeProduct,
  oauthProductForRedirect: mocks.oauthProductForRedirect,
  oauthRedirectOrigin: mocks.oauthRedirectOrigin,
  safeOAuthContinuation: (id: string) => `/oauth/consent?authorization_id=${encodeURIComponent(id)}`,
}));
vi.mock('@/lib/oauth/request-classification', () => ({ classifyOAuthRequest: mocks.classifyOAuthRequest }));

import OAuthConsentPage from '@/app/oauth/consent/page';

const user = { id: 'synthetic-user' };
const supabase = { auth: { oauth: { getAuthorizationDetails: mocks.getAuthorizationDetails } } };
const authorizationId = 'synthetic-authorization';
const productRedirect = 'https://workspace.example.test/auth/v1/callback?code=synthetic-code';
const mcpRedirect = 'https://assistant.example.test/callback?state=synthetic-state&code=synthetic-code';
const provisioningError = new Error('private provisioning details');

async function renderConsent() {
  return renderToStaticMarkup(await OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: authorizationId }) }));
}

function pendingProduct() {
  mocks.getAuthorizationDetails.mockResolvedValue({
    data: { authorization_id: authorizationId, client: { id: 'synthetic-client' }, scope: 'email profile' },
    error: null,
  });
  mocks.classifyOAuthRequest.mockResolvedValue({ kind: 'PRODUCT_HANDOFF', product: 'PERSONAL', mcp: null });
}

function completedProduct() {
  mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: productRedirect }, error: null });
  mocks.oauthProductForRedirect.mockReturnValue('PERSONAL');
}

function completedMcp() {
  mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: mcpRedirect }, error: null });
  mocks.oauthProductForRedirect.mockReturnValue(null);
  mocks.classifyOAuthRequest.mockResolvedValue({
    kind: 'WORKSPACE_MCP', product: 'PERSONAL',
    mcp: { grant_active: true, expected_redirect_uri: 'https://assistant.example.test/callback?state=synthetic-state' },
  });
}

describe('OAuth consent provisioning failure containment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.requireOAuthEntryUser.mockResolvedValue({ supabase, user });
    mocks.ensureAutomaticPersonalEntitlement.mockResolvedValue(true);
    mocks.canAuthorizeProduct.mockResolvedValue(true);
    mocks.oauthRedirectOrigin.mockReturnValue('https://workspace.example.test');
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });

  afterEach(() => vi.restoreAllMocks());

  it('offers approval for pending consent after failed provisioning only with active entitlement', async () => {
    pendingProduct();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);

    const markup = await renderConsent();

    expect(markup).toContain('value="approve" type="submit" name="decision"');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(console.error).toHaveBeenCalledExactlyOnceWith('Automatic PERSONAL entitlement provisioning unavailable');
    expect(markup).not.toContain(provisioningError.message);
  });

  it('denies pending consent after failed provisioning without active entitlement', async () => {
    pendingProduct();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockResolvedValue(false);

    const markup = await renderConsent();

    expect(markup).toContain('value="deny" type="submit" name="decision"');
    expect(markup).toContain('not currently available for this account');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
  });

  it('does not offer consent when entitlement read fails after provisioning failure', async () => {
    pendingProduct();
    const readError = new Error('entitlement read unavailable');
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockRejectedValue(readError);

    await expect(renderConsent()).rejects.toBe(readError);

    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('retains pending consent approval after successful provisioning and active entitlement', async () => {
    pendingProduct();

    const markup = await renderConsent();

    expect(markup).toContain('value="approve" type="submit" name="decision"');
    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledExactlyOnceWith(user, 'PERSONAL');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
  });

  it('redirects a completed product authorization after failed provisioning only with active entitlement', async () => {
    completedProduct();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);

    await expect(renderConsent()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(productRedirect);
  });

  it('does not redirect a completed product authorization after failed provisioning without entitlement', async () => {
    completedProduct();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockResolvedValue(false);
    mocks.classifyOAuthRequest.mockResolvedValue({ kind: 'DENY', product: null, mcp: { grant_active: false } });

    const markup = await renderConsent();

    expect(markup).toContain('Authorization required');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not redirect a completed product authorization when entitlement read fails', async () => {
    completedProduct();
    const readError = new Error('entitlement read unavailable');
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockRejectedValue(readError);

    await expect(renderConsent()).rejects.toBe(readError);

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('retains completed product redirection after successful provisioning and active entitlement', async () => {
    completedProduct();

    await expect(renderConsent()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledExactlyOnceWith(user, 'PERSONAL');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(productRedirect);
  });

  it('redirects a completed MCP authorization after failed provisioning only with active entitlement', async () => {
    completedMcp();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);

    await expect(renderConsent()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(mcpRedirect);
  });

  it('does not redirect a completed MCP authorization when entitlement read fails', async () => {
    completedMcp();
    const readError = new Error('entitlement read unavailable');
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockRejectedValue(readError);

    await expect(renderConsent()).rejects.toBe(readError);

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not redirect a completed MCP authorization without active entitlement', async () => {
    completedMcp();
    mocks.ensureAutomaticPersonalEntitlement.mockRejectedValue(provisioningError);
    mocks.canAuthorizeProduct.mockResolvedValue(false);

    const markup = await renderConsent();

    expect(markup).toContain('Authorization required');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('retains completed MCP redirection after successful provisioning and active entitlement', async () => {
    completedMcp();

    await expect(renderConsent()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.ensureAutomaticPersonalEntitlement).toHaveBeenCalledExactlyOnceWith(user, 'PERSONAL');
    expect(mocks.canAuthorizeProduct).toHaveBeenCalledExactlyOnceWith(supabase, 'PERSONAL');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(mcpRedirect);
  });
});
