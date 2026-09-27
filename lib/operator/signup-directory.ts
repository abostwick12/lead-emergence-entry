import 'server-only';

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PAGE_SIZE = 1000;
const DIRECTORY_ERROR = 'Unable to load the complete Entry account directory.';

export type EntrySignup = Readonly<{
  email: string;
  created_at: string;
}>;

type EntrySignupReader = Readonly<{
  app_metadata?: Record<string, unknown> | null;
}>;

type EntryAuthUser = Readonly<{
  email?: string;
  created_at?: string;
}>;

type EntryAuthAdminClient = Readonly<{
  auth: {
    admin: {
      listUsers(options: { page: number; perPage: number }): Promise<{
        data: { users: EntryAuthUser[]; nextPage: number | null } | null;
        error: { message?: string } | null;
      }>;
    };
  };
}>;

type DirectoryDependencies = Readonly<{
  createAdminClient?: () => EntryAuthAdminClient;
  pageSize?: number;
}>;

function createEntryAuthAdminClient(): EntryAuthAdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) throw new Error(DIRECTORY_ERROR);

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }) as unknown as EntryAuthAdminClient;
}

export function isEntrySignupReader(user: EntrySignupReader | null | undefined): boolean {
  return user?.app_metadata?.entry_signup_reader === true;
}

export async function loadAuthorizedEntrySignups(
  user: EntrySignupReader | null | undefined,
  dependencies: DirectoryDependencies = {},
): Promise<EntrySignup[] | null> {
  if (!isEntrySignupReader(user)) return null;

  const pageSize = dependencies.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error(DIRECTORY_ERROR);

  const admin = (dependencies.createAdminClient ?? createEntryAuthAdminClient)();
  const signups: EntrySignup[] = [];

  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize });
    if (error || !data) throw new Error(DIRECTORY_ERROR);
    if (data.users.length > pageSize) throw new Error(DIRECTORY_ERROR);

    for (const userRecord of data.users) {
      if (!userRecord.email || !userRecord.created_at) throw new Error(DIRECTORY_ERROR);
      signups.push({ email: userRecord.email, created_at: userRecord.created_at });
    }

    if (data.nextPage === null) break;
    if (!Number.isSafeInteger(data.nextPage) || data.nextPage !== page + 1) {
      throw new Error(DIRECTORY_ERROR);
    }
    page = data.nextPage;
  }

  return signups.sort((left, right) => right.created_at.localeCompare(left.created_at));
}
