import { NextResponse } from 'next/server';
import { exportJWK, importSPKI } from 'jose';

export const dynamic = 'force-dynamic';

export async function GET() {
  const publicKey = process.env.PRODUCT_HANDOFF_PUBLIC_KEY;
  const kid = process.env.PRODUCT_HANDOFF_KEY_ID;
  if (!publicKey || !kid) return NextResponse.json({ keys: [] }, { status: 503 });

  const key = await importSPKI(publicKey.replace(/\\n/g, '\n'), 'RS256');
  const jwk = await exportJWK(key);
  return NextResponse.json({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] }] }, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
  });
}