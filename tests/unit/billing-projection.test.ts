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

  it('times out a stalled delivery, proceeds to the next item, and retries the same delivery later', async () => {
    const later = { ...item, deliveryId: '00000000-0000-4000-8000-0000000000d2', projectionVersion: 42 };
    const state = retryableStore([item, later]);
    let timeoutSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
        timeoutSignal = init?.signal;
        if (timeoutSignal?.aborted) {
          reject(timeoutSignal.reason);
        } else {
          timeoutSignal?.addEventListener('abort', () => reject(timeoutSignal?.reason), { once: true });
        }
      }))
      .mockImplementation(async () => Response.json({ accepted: true }));

    const first = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(timeoutSignal?.aborted).toBe(true);
    expect(timeoutSignal?.reason.name).toBe('TimeoutError');
    expect(first).toEqual({ claimed: 2, delivered: 1, failed: 1 });
    expect(state.store.markFailed).toHaveBeenCalledExactlyOnceWith(
      item.deliveryId, 'WORKSPACE_TRANSPORT_UNAVAILABLE',
    );
    expect(state.delivered).toEqual([later.deliveryId]);

    const retry = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(retry).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.delivered).toEqual([later.deliveryId, item.deliveryId]);
    const sentIds = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).delivery_id);
    expect(sentIds).toEqual([item.deliveryId, later.deliveryId, item.deliveryId]);

    const afterDelivery = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(afterDelivery).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  }, 10_000);

  it.each([200, 503])('cancels the unused HTTP %i response body before recording its result', async (status) => {
    const state = retryableStore([item]);
    const events: string[] = [];
    const cancel = vi.fn(async () => {
      await Promise.resolve();
      events.push('cancelled');
    });
    vi.mocked(state.store.markDelivered).mockImplementationOnce(async () => { events.push('delivered'); });
    vi.mocked(state.store.markFailed).mockImplementationOnce(async () => { events.push('failed'); });
    const response = new Response(new ReadableStream({ cancel }), { status });
    const result = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret,
      fetchImpl: vi.fn(async () => response),
    });
    expect(cancel).toHaveBeenCalledOnce();
    const recorded = vi.mocked(status === 200 ? state.store.markDelivered : state.store.markFailed);
    expect(recorded).toHaveBeenCalledOnce();
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(recorded.mock.invocationCallOrder[0]);
    expect(events).toEqual(['cancelled', status === 200 ? 'delivered' : 'failed']);
    expect(result).toEqual({ claimed: 1, delivered: status === 200 ? 1 : 0, failed: status === 200 ? 0 : 1 });
    if (status === 503) {
      expect(state.store.markFailed).toHaveBeenCalledWith(item.deliveryId, 'WORKSPACE_HTTP_503');
    }
  });

  it('accepts a successful response with no body', async () => {
    const state = retryableStore([item]);
    const result = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret,
      fetchImpl: vi.fn(async () => new Response(null, { status: 204 })),
    });
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.store.markDelivered).toHaveBeenCalledExactlyOnceWith(item.deliveryId);
    expect(state.store.markFailed).not.toHaveBeenCalled();
  });

  it('retains a delivery for retry when response body cancellation rejects', async () => {
    const state = retryableStore([item]);
    const cancel = vi.fn(async () => { throw new Error('private response cleanup detail'); });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 200 }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const first = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(first).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(state.store.markFailed).toHaveBeenCalledExactlyOnceWith(item.deliveryId, 'WORKSPACE_TRANSPORT_UNAVAILABLE');
    expect(state.store.markDelivered).not.toHaveBeenCalled();

    const retry = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(retry).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.store.markDelivered).toHaveBeenCalledExactlyOnceWith(item.deliveryId);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).delivery_id))
      .toEqual([item.deliveryId, item.deliveryId]);
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
