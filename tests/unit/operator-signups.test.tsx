import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listUsers = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { admin: { listUsers } } })),
    getUser: vi.fn(),
    listUsers,
    notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import OperatorSignupsPage from '@/app/operator/signups/page';
import { loadAuthorizedEntrySignups } from '@/lib/operator/signup-directory';

type ListUsers = (options: { page: number; perPage: number }) => Promise<{
  data: {
    users: Array<{ email?: string | null; created_at?: string; [key: string]: unknown }>;
    nextPage: number | null;
  } | null;
  error: { message?: string } | null;
}>;

function adminClient(listUsers: ListUsers) {
  return { auth: { admin: { listUsers } } };
}

describe('Entry operator signup directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://entry.example.test';
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
  });

  it.each([
    {},
    { entry_signup_reader: false },
    { entry_signup_reader: 'true' },
  ])('returns 404 without reaching the admin directory for metadata %j', async (appMetadata) => {
    mocks.getUser.mockResolvedValue({ data: { user: { app_metadata: appMetadata } }, error: null });

    await expect(OperatorSignupsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('returns 404 without reaching the admin directory when no fresh user is authenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(OperatorSignupsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('loads every page and returns only email and created_at', async () => {
    const listUsers = vi.fn<ListUsers>()
      .mockResolvedValueOnce({
        data: { users: [
          { email: 'first@example.com', created_at: '2026-09-01T00:00:00Z', phone: 'not-returned' },
          { email: 'second@example.com', created_at: '2026-09-02T00:00:00Z', app_metadata: { not_returned: true } },
        ], nextPage: 2 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ created_at: '2026-09-03T00:00:00Z', phone: 'not-returned' }],
          nextPage: null,
        },
        error: null,
      });

    const result = await loadAuthorizedEntrySignups(
      { app_metadata: { entry_signup_reader: true } },
      { createAdminClient: () => adminClient(listUsers), pageSize: 2 },
    );

    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 2 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 2 });
    expect(result).toEqual([
      { email: null, created_at: '2026-09-03T00:00:00Z' },
      { email: 'second@example.com', created_at: '2026-09-02T00:00:00Z' },
      { email: 'first@example.com', created_at: '2026-09-01T00:00:00Z' },
    ]);
    expect(result?.every((signup) => Object.keys(signup).join(',') === 'email,created_at')).toBe(true);
  });

  it('rejects the whole directory when a later page fails', async () => {
    const listUsers = vi.fn<ListUsers>()
      .mockResolvedValueOnce({
        data: { users: [
          { email: 'first@example.com', created_at: '2026-09-01T00:00:00Z' },
          { email: 'second@example.com', created_at: '2026-09-02T00:00:00Z' },
        ], nextPage: 2 },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: 'page unavailable' } });

    await expect(loadAuthorizedEntrySignups(
      { app_metadata: { entry_signup_reader: true } },
      { createAdminClient: () => adminClient(listUsers), pageSize: 2 },
    )).rejects.toThrow('Unable to load the complete Entry account directory.');
  });

  it('shows an error instead of an apparently complete list when loading fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getUser.mockResolvedValue({
      data: { user: { app_metadata: { entry_signup_reader: true } } },
      error: null,
    });
    mocks.listUsers.mockResolvedValue({ data: null, error: { message: 'directory unavailable' } });

    const html = renderToStaticMarkup(await OperatorSignupsPage());

    expect(html).toContain('Account directory unavailable');
    expect(html).toContain('No partial account list is shown.');
    expect(html).not.toContain('<table');
    expect(consoleError).toHaveBeenCalledWith('Entry signup directory load failed', {
      code: 'admin_request_failed',
    });
    consoleError.mockRestore();
  });

  it('renders only approved account fields for an authorized reader', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { app_metadata: { entry_signup_reader: true } } },
      error: null,
    });
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            email: 'reader-visible@example.com',
            created_at: '2026-09-04T00:00:00Z',
            last_sign_in_at: 'not-visible',
            app_metadata: { internal: 'not-visible' },
          },
          {
            created_at: '2026-09-03T00:00:00Z',
            phone: '555-not-visible',
          },
        ],
        nextPage: null,
      },
      error: null,
    });

    const html = renderToStaticMarkup(await OperatorSignupsPage());

    expect(html).toContain('reader-visible@example.com');
    expect(html).toContain('Account created');
    expect(html).toContain('2026-09-04T00:00:00Z');
    expect(html).toContain('No email');
    expect(html).toContain('Request recovery email');
    expect(html).not.toContain('token_hash');
    expect(html).not.toContain('555-not-visible');
    expect(html).not.toContain('last_sign_in_at');
    expect(html).not.toContain('not-visible');
  });
});
