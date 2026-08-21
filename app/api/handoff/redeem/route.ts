import { NextResponse } from 'next/server';
import { redeemConsultingNonce, redemptionRequestSchema } from '@/lib/handoff/redemption';

export async function POST(request: Request) {
  const expected = process.env.ENTRY_HANDOFF_REDEEM_SECRET;
  if (!expected) return NextResponse.json({ error: 'Handoff redemption unavailable' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Handoff redemption denied' }, { status: 401 });
  }
  try {
    const body = redemptionRequestSchema.parse(await request.json());
    const redeemed = await redeemConsultingNonce(body);
    if (!redeemed) return NextResponse.json({ error: 'Handoff already redeemed or invalid' }, { status: 409 });
    return NextResponse.json({ redeemed: true });
  } catch {
    return NextResponse.json({ error: 'Invalid handoff redemption request' }, { status: 400 });
  }
}