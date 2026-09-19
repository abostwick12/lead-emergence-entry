import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureAutomaticPersonalEntitlement: vi.fn(),
  getActiveProducts: vi.fn(),
  requireCanonicalIdentity: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/identity/automatic-personal', () => ({
  ensureAutomaticPersonalEntitlement: mocks.ensureAutomaticPersonalEntitlement,
}));
vi.mock('@/lib/identity/server', () => ({
  getActiveProducts: mocks.getActiveProducts,
  requireCanonicalIdentity: mocks.requireCanonicalIdentity,
}));

import WorkspacesPage from '@/app/workspaces/page';

describe('workspaces empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCanonicalIdentity.mockResolvedValue({ supabase: {} });
    mocks.getActiveProducts.mockResolvedValue([]);
  });

  it('exposes the normal PERSONAL handoff without mutating entitlement state', async () => {
    const markup = renderToStaticMarkup(await WorkspacesPage());

    expect(markup).toContain('href="/handoff/personal"');
    expect(markup).toContain('Open Workspace');
    expect(mocks.requireCanonicalIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.getActiveProducts).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAutomaticPersonalEntitlement).not.toHaveBeenCalled();
  });
});
