import 'server-only';

import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export type PersonalProjectionKind = 'BILLING' | 'NON_BILLING_AUTHORITY';

export type PersonalProjectionOutboxItem = {
  deliveryId: string;
  projectionKind: PersonalProjectionKind;
  projectionVersion: number;
  canonicalUserId: string;
  projectedAt: string;
  projectionData: Record<string, unknown>;
  attempts: number;
};

export type PersonalProjectionOutboxStore = {
  claim(limit: number): Promise<PersonalProjectionOutboxItem[]>;
  markDelivered(deliveryId: string): Promise<void>;
  markFailed(deliveryId: string, sanitizedError: string): Promise<void>;
};

type ProjectionRow = {
  delivery_id: string;
  projection_kind: PersonalProjectionKind;
  projection_version: number;
  canonical_user_id: string;
  projected_at: string;
  projection_data: Record<string, unknown>;
  attempts: number;
};

function projectionServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('Entry projection database configuration is incomplete');
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function createEntryProjectionOutboxStore(): PersonalProjectionOutboxStore {
  const service = projectionServiceClient();
  const mark = async (deliveryId: string, delivered: boolean, sanitizedError: string | null) => {
    const { data, error } = await service.rpc('mark_entry_personal_projection_delivery', {
      p_delivery_id: deliveryId,
      p_delivered: delivered,
      p_sanitized_error: sanitizedError,
    });
    if (error || data !== true) throw new Error('Projection delivery state could not be persisted');
  };
  return {
    async claim(limit) {
      const { data, error } = await service.rpc('claim_entry_personal_projection_batch', { p_limit: limit });
      if (error) throw new Error('Pending projections could not be claimed');
      return ((data ?? []) as ProjectionRow[]).map((row) => ({
        deliveryId: row.delivery_id,
        projectionKind: row.projection_kind,
        projectionVersion: Number(row.projection_version),
        canonicalUserId: row.canonical_user_id,
        projectedAt: row.projected_at,
        projectionData: row.projection_data,
        attempts: row.attempts,
      }));
    },
    markDelivered(deliveryId) {
      return mark(deliveryId, true, null);
    },
    markFailed(deliveryId, sanitizedError) {
      return mark(deliveryId, false, sanitizedError);
    },
  };
}

function configuredProjectionTransport() {
  const rawUrl = process.env.WORKSPACE_PERSONAL_PROJECTION_URL;
  const secret = process.env.WORKSPACE_PROJECTION_HMAC_SECRET;
  if (!rawUrl || !secret || secret.length < 32) {
    throw new Error('Workspace projection transport is not configured');
  }
  const url = new URL(rawUrl);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Workspace projection transport must use HTTPS');
  }
  return { url: url.toString(), secret };
}

export function signPersonalProjection(secret: string, timestamp: string, rawBody: string) {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export async function drainPersonalProjectionOutbox({
  store,
  endpoint,
  secret,
  limit = 10,
  fetchImpl = fetch,
  now = () => Date.now(),
}: {
  store: PersonalProjectionOutboxStore;
  endpoint: string;
  secret: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  if (limit < 1 || limit > 25) throw new Error('Projection drain limit must be between 1 and 25');
  if (secret.length < 32) throw new Error('Projection HMAC secret must contain at least 32 characters');

  const items = await store.claim(limit);
  let delivered = 0;
  let failed = 0;
  for (const item of items) {
    const body = JSON.stringify({
      protocol_version: '1',
      delivery_id: item.deliveryId,
      projection_kind: item.projectionKind,
      projection_version: item.projectionVersion,
      canonical_user_id: item.canonicalUserId,
      projected_at: item.projectedAt,
      projection_data: item.projectionData,
    });
    const timestamp = String(Math.floor(now() / 1000));
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-le-projection-timestamp': timestamp,
          'x-le-projection-signature': signPersonalProjection(secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(3_000),
      });
      await response.body?.cancel();
      if (!response.ok) {
        await store.markFailed(item.deliveryId, `WORKSPACE_HTTP_${response.status}`);
        failed += 1;
        continue;
      }
      await store.markDelivered(item.deliveryId);
      delivered += 1;
    } catch {
      try {
        await store.markFailed(item.deliveryId, 'WORKSPACE_TRANSPORT_UNAVAILABLE');
      } catch {
        console.error('Workspace projection delivery status unavailable', {
          deliveryId: item.deliveryId,
        });
      }
      failed += 1;
    }
  }
  return { claimed: items.length, delivered, failed };
}

export async function drainConfiguredPersonalProjectionOutbox(limit = 10) {
  const transport = configuredProjectionTransport();
  return drainPersonalProjectionOutbox({
    store: createEntryProjectionOutboxStore(),
    endpoint: transport.url,
    secret: transport.secret,
    limit,
  });
}
