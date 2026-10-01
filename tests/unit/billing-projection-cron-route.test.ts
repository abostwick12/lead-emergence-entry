import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainConfiguredPersonalProjectionOutbox: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/billing/projection', () => ({
  drainConfiguredPersonalProjectionOutbox: mocks.drainConfiguredPersonalProjectionOutbox,
}));

import { GET } from '@/app/api/internal/cron/personal-projection-drain/route';

const originalCronSecret = process.env.CRON_SECRET;
const cronSecret = 'entry-cron-secret-at-least-16-characters';

function request(authorization?: string, query = '') {
  return new Request(
    `https://entry.example.test/api/internal/cron/personal-projection-drain${query}`,
    { headers: authorization ? { authorization } : undefined },
  );
}

describe('Entry PERSONAL projection drain cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = cronSecret;
    mocks.drainConfiguredPersonalProjectionOutbox.mockResolvedValue({
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
  });

  afterAll(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('fails closed when CRON_SECRET is unavailable', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request(`Bearer ${cronSecret}`));
    expect(response.status).toBe(503);
    expect(mocks.drainConfiguredPersonalProjectionOutbox).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.drainConfiguredPersonalProjectionOutbox).not.toHaveBeenCalled();
  });

  it.each([
    'Basic credentials',
    'Bearer wrong-secret',
    `Bearer  ${cronSecret}`,
  ])('rejects malformed or incorrect Authorization: %s', async (authorization) => {
    const response = await GET(request(authorization));
    expect(response.status).toBe(401);
    expect(mocks.drainConfiguredPersonalProjectionOutbox).not.toHaveBeenCalled();
  });

  it('accepts the exact bearer secret and reports a successful no-op', async () => {
    const response = await GET(request(`Bearer ${cronSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledOnce();
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledWith(10);
  });

  it('reports a bounded successful drain without exposing projection contents', async () => {
    mocks.drainConfiguredPersonalProjectionOutbox.mockResolvedValue({
      claimed: 10,
      delivered: 10,
      failed: 0,
    });
    const response = await GET(request(`Bearer ${cronSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 10,
      delivered: 10,
      failed: 0,
    });
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledWith(10);
  });

  it('reports partial failure and allows the next fixed drain to retry', async () => {
    mocks.drainConfiguredPersonalProjectionOutbox
      .mockResolvedValueOnce({ claimed: 1, delivered: 0, failed: 1 })
      .mockResolvedValueOnce({ claimed: 1, delivered: 1, failed: 0 });

    const failed = await GET(request(`Bearer ${cronSecret}`));
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({
      ok: false,
      claimed: 1,
      delivered: 0,
      failed: 1,
    });

    const retried = await GET(request(`Bearer ${cronSecret}`));
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({
      ok: true,
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledTimes(2);
  });

  it('ignores arbitrary job selectors and invokes only the fixed PERSONAL drain', async () => {
    const response = await GET(request(`Bearer ${cronSecret}`, '?job=stripe-mutation'));
    expect(response.status).toBe(200);
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledOnce();
    expect(mocks.drainConfiguredPersonalProjectionOutbox).toHaveBeenCalledWith(10);
  });

  it('keeps the cron credential server-only and schedules exactly one five-minute job', () => {
    const envExample = readFileSync(path.resolve('.env.example'), 'utf8');
    const schedulerMigration = readFileSync(
      path.resolve('supabase/migrations/20260921210000_entry_projection_drain_scheduler.sql'),
      'utf8',
    );

    expect(envExample).toContain('\nCRON_SECRET=');
    expect(envExample).not.toContain('NEXT_PUBLIC_CRON_SECRET');
    expect(schedulerMigration.match(/\bcron\.schedule\s*\(/g)).toHaveLength(1);
    expect(schedulerMigration).toMatch(/select cron\.schedule\(\s*'entry_personal_projection_outbox_drain',\s*'\*\/5 \* \* \* \*',/);
    expect(schedulerMigration).toContain("url := 'https://entry.leademergence.com/api/internal/cron/personal-projection-drain'");
    expect(schedulerMigration).toMatch(/'Authorization',\s*'Bearer '\s*\|\|\s*\(\s*select decrypted_secret\s+from vault\.decrypted_secrets\s+where name = 'cron_secret'/);
  });
});
