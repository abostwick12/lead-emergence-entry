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

export function safeExactOAuthRedirect(value: string, expectedRedirectUri: string | null | undefined) {
  try {
    const destination = new URL(value);
    const expected = expectedRedirectUri ? new URL(expectedRedirectUri) : null;
    if (!expected || destination.origin !== expected.origin || destination.pathname !== expected.pathname) return null;
    if (destination.username || destination.password || destination.hash) return null;
    for (const [key, expectedValue] of expected.searchParams) {
      if (!destination.searchParams.getAll(key).includes(expectedValue)) return null;
    }
    for (const [key, destinationValue] of destination.searchParams) {
      const expectedValues = expected.searchParams.getAll(key);
      if (expectedValues.length > 0 && expectedValues.includes(destinationValue)) continue;
      // Supabase adds only the authorization response values after preserving
      // the registered redirect URI. Do not allow a client-controlled extra.
      if ((key === 'code' || key === 'state' || key === 'error' || key === 'error_description')
        && expectedValues.length === 0) continue;
      return null;
    }
    return destination;
  } catch {
    return null;
  }
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
