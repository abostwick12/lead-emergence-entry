import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  drainPersonalProjectionOutbox,
  signPersonalProjection,
  type PersonalProjectionOutboxItem,
  type PersonalProjectionOutboxStore,
} from '@/lib/billing/projection';

const secret = 'slice-d-entry-projection-secret-32-chars';
const item: PersonalProjectionOutboxItem = {
  deliveryId: '00000000-0000-4000-8000-0000000000d1',
  projectionKind: 'BILLING',
  projectionVersion: 41,
  canonicalUserId: '00000000-0000-4000-8000-0000000000a1',
  projectedAt: '2026-09-19T18:00:00.000Z',
  projectionData: {
    effective_state: 'ACTIVE',
    trial_started_at: null,
    trial_ends_at: null,
    current_period_started_at: null,
    current_period_ends_at: null,
    grace_until: null,
    cancel_at_period_end: false,
    payment_method_required: false,
  },
  attempts: 1,
};

function retryableStore(initial: PersonalProjectionOutboxItem[]) {
  const pending = [...initial];
  const delivered: string[] = [];
  const failures: string[] = [];
  const store: PersonalProjectionOutboxStore = {
    claim: vi.fn(async (limit) => pending.filter((entry) => !delivered.includes(entry.deliveryId)).slice(0, limit)),
    markDelivered: vi.fn(async (deliveryId) => { delivered.push(deliveryId); }),
    markFailed: vi.fn(async (deliveryId) => { failures.push(deliveryId); }),
  };
  return { store, delivered, failures };
}

describe('Entry PERSONAL projection delivery', () => {
  it('signs timestamp dot exact raw body with HMAC-SHA256', () => {
    const body = '{"exact":"body"}';
    const timestamp = '1789840800';
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(signPersonalProjection(secret, timestamp, body)).toBe(`v1=${expected}`);
  });

  it('retains a failed delivery for retry without undoing canonical state', async () => {
    const state = retryableStore([item]);
    const result = await drainPersonalProjectionOutbox({
      store: state.store,
      endpoint: 'https://workspace.test/projection',
      secret,
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
    });
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(state.failures).toEqual([item.deliveryId]);
    expect(state.delivered).toEqual([]);
  });

  it('delivers the same retained projection successfully on a later drain', async () => {
    const state = retryableStore([item]);
    await drainPersonalProjectionOutbox({
      store: state.store,
      endpoint: 'https://workspace.test/projection',
      secret,
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
    });
    const result = await drainPersonalProjectionOutbox({
      store: state.store,
      endpoint: 'https://workspace.test/projection',
      secret,
      fetchImpl: vi.fn(async () => Response.json({ accepted: true })),
    });
    expect(result.delivered).toBe(1);
    expect(state.delivered).toEqual([item.deliveryId]);
  });

  it('does not redeliver an item after its successful delivery is recorded', async () => {
    const state = retryableStore([item]);
    const fetchImpl = vi.fn(async () => Response.json({ accepted: true }));
    await drainPersonalProjectionOutbox({ store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl });
    const second = await drainPersonalProjectionOutbox({ store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl });
    expect(second).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('preserves monotonic outbox order when a later version follows an older retry', async () => {
    const later = { ...item, deliveryId: '00000000-0000-4000-8000-0000000000d2', projectionVersion: 42 };
    const state = retryableStore([item, later]);
    const seenVersions: number[] = [];
    await drainPersonalProjectionOutbox({
      store: state.store,
      endpoint: 'https://workspace.test/projection',
      secret,
      fetchImpl: vi.fn(async (_input, init) => {
        seenVersions.push(JSON.parse(String(init?.body)).projection_version as number);
        return Response.json({ accepted: true });
      }),
    });
    expect(seenVersions).toEqual([41, 42]);
  });
});
