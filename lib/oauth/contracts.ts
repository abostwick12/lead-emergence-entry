export function productOAuthStartUrl(
  productBaseUrl: string,
  allowLocalHttp = process.env.NODE_ENV !== 'production',
) {
  const destination = new URL(productBaseUrl);
  if (destination.username || destination.password) throw new Error('Product destination cannot contain credentials');
  if (destination.protocol !== 'https:'
    && !(allowLocalHttp && destination.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(destination.hostname))) {
    throw new Error('Product destination must use HTTPS');
  }
  return new URL('/auth/entry', destination).toString();
}

export function safeOAuthRedirect(
  value: string,
  expectedOrigin: string | undefined,
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

export function uniqueOAuthRedirectProduct<T extends string>(
  candidate: string,
  products: readonly T[],
  expectedOrigin: (product: T) => string | undefined,
): T | null {
  const matches = products.filter((product) => Boolean(safeOAuthRedirect(candidate, expectedOrigin(product))));
  return matches.length === 1 ? matches[0] : null;
}

export function uniqueConfiguredProduct<T extends string>(
  candidate: string,
  products: readonly T[],
  configuredValue: (product: T) => string | undefined,
): T | null {
  const matches = products.filter((product) => {
    const configured = configuredValue(product);
    return Boolean(configured) && candidate === configured;
  });
  return matches.length === 1 ? matches[0] : null;
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
