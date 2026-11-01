# Entry boundary

```text
Lead Emergence Entry
  ├─ canonical authentication
  ├─ identity profile
  ├─ ACTIVE product entitlement
  ├─ product chooser
  └─ short-lived product handoff
       ├─ Personal (product-owned authorization + data)
       ├─ Ministry (product-owned authorization + data)
       └─ Consulting (product-owned authorization + data)
```

Entry may know: `canonical_user_id` and whether the identity has an active entitlement for a product.

Entry must not know: product role, organization, engagement, workspace, visibility, or domain records.

## Connection and entitlement clarification

An active Entry product entitlement is eligibility to begin product
authorization; it is not proof of payment or product-local access. Workspace
retains its own authorization and applicable subscription-entitlement rules,
including existing exceptions. See the [canonical connection, authorization,
and entitlement model](https://github.com/abostwick12/lead-emergence-control-plane/blob/main/docs/CONNECTION_AUTHORIZATION_ENTITLEMENT_MODEL.md)
for intended service-connection ownership and evidence limits.
