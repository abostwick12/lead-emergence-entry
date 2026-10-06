import { timingSafeEqual } from 'node:crypto';
import { drainConfiguredPersonalProjectionOutbox } from '@/lib/billing/projection';

export const runtime = 'nodejs';

function authorized(request: Request, secret: string): boolean {
  const provided = request.headers.get('authorization');
  if (!provided || !provided.startsWith('Bearer ')) return false;

  const expected = `Bearer ${secret}`;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'Projection drain unavailable' }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainConfiguredPersonalProjectionOutbox(10);
    return Response.json(
      { ok: result.failed === 0, ...result },
      { status: result.failed === 0 ? 200 : 503 },
    );
  } catch {
    return Response.json({ ok: false, error: 'Projection drain unavailable' }, { status: 503 });
  }
}
