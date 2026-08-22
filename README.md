# Lead Emergence Entry

The neutral Lead Emergence entry and canonical identity boundary.

## Owns

- Public ecosystem entry
- Canonical authentication and identity profile
- Minimal global product entitlement
- Product chooser and secure handoff initiation
- Canonical account settings

## Does not own

- Personal domain data or authorization
- Ministry domain data or authorization
- Consulting domain data or authorization
- Product roles, organizations, engagements, workspaces, or record visibility

## Local setup

1. Install Node.js 24 or newer.
2. Copy `.env.example` to `.env.local` and provide a dedicated Supabase project.
3. Install dependencies with `npm install`.
4. Apply migrations with the Supabase CLI when a local project is available.
5. Run `npm run dev`.

No production DNS, hosted Supabase settings, user migration, or sibling repository changes are part of this foundation.

Entry uses the same OAuth/OIDC authorization-server contract for Consulting and
Personal. Each product has a separate client ID, exact callback origin, product
destination, and entitlement check. See
`docs/architecture/entry-consulting-handoff.md` and
`docs/architecture/entry-workspace-sso.md`.
