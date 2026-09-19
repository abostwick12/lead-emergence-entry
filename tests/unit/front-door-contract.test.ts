import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landing = readFileSync('app/landing-experience.tsx', 'utf8');
const workspaces = readFileSync('app/workspaces/page.tsx', 'utf8');

describe('Entry unified front-door contract', () => {
  it('routes public product entry through canonical Entry sign-in', () => {
    expect(landing).toMatch(/href="\/login">Sign in to Lead Emergence/);
    expect(landing).not.toMatch(/NEXT_PUBLIC_WORKSPACE_URL/);
    expect(landing).not.toMatch(/href=\{WORKSPACE_URL\}/);
  });

  it('auto-continues one product and renders a choice only for several active products', () => {
    expect(workspaces).toMatch(/if \(entitlements\.length === 1\) redirect\(`\/handoff\/\$\{entitlements\[0\]\.toLowerCase\(\)\}`\)/);
    expect(workspaces).toMatch(/entitlements\.length > 1 \? <section role="dialog"/);
    expect(workspaces).toMatch(/One Lead Emergence sign-in/);
  });
});
