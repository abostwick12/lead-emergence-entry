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

## Production source and release status

Current launch gates and timestamped production evidence live in the [canonical roadmap](https://github.com/abostwick12/lead-emergence-control-plane/blob/main/docs/ROADMAP.md) and [production state](https://github.com/abostwick12/lead-emergence-control-plane/blob/main/docs/status/PRODUCTION_STATE.md). Repository main is not proof of the deployed upload. The October 3 audit found that retained production source contains billing/projection paths absent from main; complete the reviewed release-baseline reconciliation before another production release. Historical foundation and Preview notes below do not authorize provisioning, migration, or cutover.

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
