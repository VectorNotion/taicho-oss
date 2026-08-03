# Role and entitlement boundary review

Date: 25 July 2026
Ticket: UX-06
Scope: browser routes, API routes, plan capabilities, product entitlements,
credit reservations, and administration boundaries

## Boundary matrix

| Principal or state | Allowed | Denied |
| --- | --- | --- |
| Workspace owner | Entitled products, writes, administration, billing | Platform-operator-only commercial console unless allowlisted |
| Team administrator | Workspace administration view and assigned Growth team | Organization membership/role mutations, unassigned Editorial team |
| Outreach operator | Outreach reads, creation, updates, research, qualification, messaging, imports, and sync | Destructive lead deletion and Content |
| Content editor | Content reads, creation, updates, research, and generation | Outreach and content publishing |
| Viewer | Read-only access to entitled products | Product writes and administration |
| Expired/cancelled plan | Authentication, profile, billing, and recovery request paths | Product capabilities, new billing-period grants, and provider-backed actions |
| Exhausted credits | Product reads and billing | Variable-cost work before provider invocation; API returns 402 with required and available credits |
| Product not entitled | Other entitled products | Browser and API access to the missing product even when the plan and role would otherwise allow it |

## Implementation findings

The review found that subscription `status` and `period_end` were previously
display-only: authorization used the plan capability array even after expiry,
and the legacy weekly-grant path could add a new allowance to an expired subscription.
The commercial summary now derives an effective `active`, `expired`, or
`cancelled` state. Inactive subscriptions expose no authorization
capabilities, invalidate remaining included grants, and raise a structured
`SUBSCRIPTION_INACTIVE` error at commercial action boundaries. Reactivation
starts a new period and supersedes the prior grant key so one fresh allowance
can be issued without making billing-period grants non-idempotent.

The 29 July pricing migration also removed per-member Team wallets. Team seats
now fund one organization pool, while `usage_event.user_id` preserves the
initiator for audit and reporting.

Billing, profile, and access-denied screens now distinguish plan expiry from a
role or product-entitlement denial and offer a billing recovery path.

## Evidence

- Commerce integration tests cover active-plan capabilities, expiry,
  cancellation, reactivation, zero-credit denial, reservation idempotency, and
  concurrent overspend prevention.
- Existing `auth-rbac.spec.ts` covers owner, team administrator, outreach
  operator, content editor, and viewer browser/API boundaries.
- `commercial-boundaries.spec.ts` covers expired, exhausted, and unentitled
  workspaces with deterministic, production-forbidden fixtures.
- `role-entitlement-boundaries.test.mjs` prevents removal of a required
  identity/state, fail-closed subscription behavior, fixture safety guard, or
  release-workflow seed.

UX-06 closes only when these suites pass for the immutable release candidate
and the deployed access-denied, billing, and API responses are smoke-tested.
