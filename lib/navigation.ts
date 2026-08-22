export function safeEntryReturnPath(value: string | null | undefined) {
  const fallback = '/workspaces';
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || /[\u0000-\u001F\u007F]/.test(value)) return fallback;

  try {
    const parsed = new URL(value, 'https://entry.leademergence.invalid');
    if (parsed.origin !== 'https://entry.leademergence.invalid') return fallback;
    const path = `${parsed.pathname}${parsed.search}`;
    if (path === '/workspaces' || path === '/account' || path === '/update-password') return path;
    if (parsed.pathname !== '/oauth/consent' || parsed.hash) return fallback;
    const authorizationId = parsed.searchParams.get('authorization_id');
    if (!authorizationId || authorizationId.length > 512) return fallback;
    if ([...parsed.searchParams.keys()].some((key) => key !== 'authorization_id')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
