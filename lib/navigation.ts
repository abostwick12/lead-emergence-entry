import type { EmailOtpType } from '@supabase/supabase-js';

const emailOtpTypes = new Set<EmailOtpType>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

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

export function safeEmailOtpType(value: string | null): EmailOtpType | null {
  return value && emailOtpTypes.has(value) ? value : null;
}

export function emailOtpDestination(type: EmailOtpType, requestedPath: string | null) {
  if (type === 'invite' || type === 'recovery') return '/update-password';
  return safeEntryReturnPath(requestedPath);
}
