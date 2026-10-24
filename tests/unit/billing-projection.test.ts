import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import {
  createEntryProjectionOutboxStore,
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
  it('passes each claimed attempt to the restricted result RPC', async () => {
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const priorSecret = process.env.SUPABASE_SECRET_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://entry.example.test';
    process.env.SUPABASE_SECRET_KEY = 'local-test-secret';
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createClient>);
    try {
      const store = createEntryProjectionOutboxStore();
      await store.markDelivered(item.deliveryId, 2);
      await store.markFailed(item.deliveryId, 3, 'WORKSPACE_HTTP_503');
      expect(rpc).toHaveBeenNthCalledWith(1, 'mark_entry_personal_projection_delivery', {
        p_delivery_id: item.deliveryId, p_expected_attempt: 2,
        p_delivered: true, p_sanitized_error: null,
      });
      expect(rpc).toHaveBeenNthCalledWith(2, 'mark_entry_personal_projection_delivery', {
        p_delivery_id: item.deliveryId, p_expected_attempt: 3,
        p_delivered: false, p_sanitized_error: 'WORKSPACE_HTTP_503',
      });
    } finally {
      if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
      if (priorSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = priorSecret;
      vi.mocked(createClient).mockReset();
    }
  });

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
      item.deliveryId, item.attempts, 'WORKSPACE_TRANSPORT_UNAVAILABLE',
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
      expect(state.store.markFailed).toHaveBeenCalledWith(item.deliveryId, item.attempts, 'WORKSPACE_HTTP_503');
    }
  });

  it('accepts a successful response with no body', async () => {
    const state = retryableStore([item]);
    const result = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret,
      fetchImpl: vi.fn(async () => new Response(null, { status: 204 })),
    });
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.store.markDelivered).toHaveBeenCalledExactlyOnceWith(item.deliveryId, item.attempts);
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
    expect(state.store.markFailed).toHaveBeenCalledExactlyOnceWith(item.deliveryId, item.attempts, 'WORKSPACE_TRANSPORT_UNAVAILABLE');
    expect(state.store.markDelivered).not.toHaveBeenCalled();

    const retry = await drainPersonalProjectionOutbox({
      store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
    });
    expect(retry).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.store.markDelivered).toHaveBeenCalledExactlyOnceWith(item.deliveryId, item.attempts);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).delivery_id))
      .toEqual([item.deliveryId, item.deliveryId]);
  });

  it.each(['success', 'http_error', 'transport_error'] as const)(
    'continues the batch and preserves retry when status writes fail after %s', async (responseKind) => {
      const later = { ...item, deliveryId: '00000000-0000-4000-8000-0000000000d2', projectionVersion: 42 };
      const state = retryableStore([item, later]);
      let failFirstWrites = true;
      vi.mocked(state.store.markDelivered).mockImplementation(async (deliveryId) => {
        if (failFirstWrites && deliveryId === item.deliveryId) throw new Error('private status persistence details');
        state.delivered.push(deliveryId);
      });
      vi.mocked(state.store.markFailed).mockImplementation(async (deliveryId) => {
        if (failFirstWrites && deliveryId === item.deliveryId) throw new Error('private status persistence details');
        state.failures.push(deliveryId);
      });
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        const deliveryId = JSON.parse(String(init?.body)).delivery_id;
        if (failFirstWrites && deliveryId === item.deliveryId) {
          if (responseKind === 'transport_error') throw new Error('private transport details');
          if (responseKind === 'http_error') return new Response(null, { status: 503 });
        }
        return new Response(null, { status: 204 });
      });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const first = await drainPersonalProjectionOutbox({
          store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
        });
        expect(first).toEqual({ claimed: 2, delivered: 1, failed: 1 });
        expect(state.delivered).toEqual([later.deliveryId]);
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
          'Workspace projection delivery status unavailable', { deliveryId: item.deliveryId },
        );

        failFirstWrites = false;
        const retry = await drainPersonalProjectionOutbox({
          store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
        });
        expect(retry).toEqual({ claimed: 1, delivered: 1, failed: 0 });
        expect(state.delivered).toEqual([later.deliveryId, item.deliveryId]);
        expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).delivery_id))
          .toEqual([item.deliveryId, later.deliveryId, item.deliveryId]);
        const afterDelivery = await drainPersonalProjectionOutbox({
          store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
        });
        expect(afterDelivery).toEqual({ claimed: 0, delivered: 0, failed: 0 });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
      } finally {
        errorLog.mockRestore();
      }
    },
  );

  it('does not repeat a committed HTTP-failure status write when its response is lost', async () => {
    const later = { ...item, deliveryId: '00000000-0000-4000-8000-0000000000d2', projectionVersion: 42, attempts: 2 };
    const state = retryableStore([item, later]);
    vi.mocked(state.store.markFailed).mockImplementationOnce(async (deliveryId) => {
      state.failures.push(deliveryId);
      throw new Error('private status response detail');
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = await drainPersonalProjectionOutbox({
        store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
      });
      expect(first).toEqual({ claimed: 2, delivered: 1, failed: 1 });
      expect(state.store.markFailed).toHaveBeenCalledExactlyOnceWith(item.deliveryId, item.attempts, 'WORKSPACE_HTTP_503');
      expect(state.failures).toEqual([item.deliveryId]);
      expect(state.delivered).toEqual([later.deliveryId]);
      expect(state.store.markDelivered).toHaveBeenCalledWith(later.deliveryId, later.attempts);
      expect(errorLog).toHaveBeenCalledExactlyOnceWith(
        'Workspace projection delivery status unavailable', { deliveryId: item.deliveryId },
      );

      const retry = await drainPersonalProjectionOutbox({
        store: state.store, endpoint: 'https://workspace.test/projection', secret, fetchImpl,
      });
      expect(retry).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(state.delivered).toEqual([later.deliveryId, item.deliveryId]);
      expect(state.store.markDelivered).toHaveBeenCalledWith(item.deliveryId, item.attempts);
    } finally {
      errorLog.mockRestore();
    }
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
