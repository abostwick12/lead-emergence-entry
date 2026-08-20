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
