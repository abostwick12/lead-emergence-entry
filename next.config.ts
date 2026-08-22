import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

function supabaseOrigin() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredHttpsOrigin(name: string) {
  const value = process.env[name];
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (!isProduction && url.protocol === 'http:')) return url.origin;
  } catch {
    // An invalid origin stays excluded from the security policy.
  }
  return null;
}

function contentSecurityPolicy() {
  const supabase = supabaseOrigin();
  const consultingOAuthRedirect = configuredHttpsOrigin('ENTRY_CONSULTING_OAUTH_REDIRECT_ORIGIN');
  const consultingProduct = configuredHttpsOrigin('CONSULTING_PRODUCT_URL');
  const connect = ["'self'", supabase, supabase ? `wss://${new URL(supabase).host}` : null, isProduction ? null : 'ws:']
    .filter(Boolean)
    .join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `form-action ${["'self'", consultingOAuthRedirect, consultingProduct].filter(Boolean).join(' ')}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    // Next.js inlines its hydration bootstrap. Moving to nonces requires making
    // every route dynamic, so retain the narrow framework-compatible policy.
    `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
    `connect-src ${connect}`,
  ].join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
