# ADR-0001: Canonical Identity and Neutral Entry

- Status: Accepted for foundation implementation
- Date: 2026-08-19

## Context

Lead Emergence has independent Personal, Ministry, and Consulting products. A shared login experience is useful, but shared domain authorization would collapse product boundaries and create an unsafe global authority.

## Decision

Create a dedicated Entry application and Supabase project. Entry owns authentication, canonical identity profiles, and minimal product entitlements. It exposes a chooser and starts audience-bound handoffs. Each product independently resolves its local identity, roles, memberships, RLS, and record visibility.

## Constraints

Entry contains no product domain data and no global roles. Entitlements mean only that an identity may begin entering a product. Product sessions remain host-only; no wildcard identity cookie is used.

## Rejected alternatives

- Consulting-, Ministry-, or Personal-owned identity
- Global product roles
- One merged product database
- Shared wildcard cookies
- Email-only account linking
- Consumer self-service entitlement grants

## Consequences

The ecosystem gets a coherent one-login UX while products retain authorization independence. Handoffs require explicit product contracts and key distribution. Existing products and users are not migrated by this ADR.
