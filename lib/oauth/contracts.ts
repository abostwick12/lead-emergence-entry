export function consultingOAuthStartUrl(
  productBaseUrl: string,
  allowLocalHttp = process.env.NODE_ENV !== 'production',
) {
  const destination = new URL(productBaseUrl);
  if (destination.username || destination.password) throw new Error('Consulting destination cannot contain credentials');
  if (destination.protocol !== 'https:'
    && !(allowLocalHttp && destination.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(destination.hostname))) {
    throw new Error('Consulting destination must use HTTPS');
  }
  return new URL('/auth/entry', destination).toString();
}

export function safeOAuthRedirect(
  value: string,
  expectedOrigin = process.env.ENTRY_CONSULTING_OAUTH_REDIRECT_ORIGIN,
  allowLocalHttp = process.env.NODE_ENV !== 'production',
) {
  try {
    const destination = new URL(value);
    const expected = expectedOrigin ? new URL(expectedOrigin) : null;
    if (!expected || destination.origin !== expected.origin) return null;
    if (destination.pathname !== '/auth/v1/callback' || destination.username || destination.password || destination.hash) return null;
    if (destination.protocol === 'https:') return destination;
    if (allowLocalHttp && destination.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(destination.hostname)) return destination;
  } catch {
    // Invalid URL.
  }
  return null;
}

export function isTrustedOAuthFormOrigin(requestUrl: string, suppliedOrigin: string | null, appOrigin: string | undefined) {
  if (!suppliedOrigin || !appOrigin) return false;
  try {
    return new URL(suppliedOrigin).origin === new URL(appOrigin).origin
      && new URL(requestUrl).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}
