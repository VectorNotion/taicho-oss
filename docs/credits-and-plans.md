# Plans and credits

Vector Notion's commercial layer is separate from roles and product
permissions. A billable request must pass plan capability, RBAC, and credit
reservation checks.

Payload is the catalog source of truth. The versioned PostgreSQL projection
contains `trial`, `plus`, `pro`, `team`, and `enterprise`:

- Trial: one non-renewing seven-day period with 300 user-owned credits.
- Plus: ₹2,999 per month with 4,000 user-owned credits per billing period.
- Pro: ₹10,999 per month with 20,000 user-owned credits per billing period.
- Team: ₹14,999 per billed seat per month. Each seat contributes 20,000 credits
  per billing period to one organization pool; Team members have no individual
  credit balance.
- Enterprise: contact-based commercial terms and organization ownership.

New organizations provision the trial. A cancelled or expired paid
subscription does not fall back to another trial.

Included lots use the subscription's actual `period_start` and `period_end`.
They expire and refresh at the billing-period boundary, never on a calendar
weekday. A user-owned allowance is pinned to the subscription owner, so another
organization member cannot mint an additional Plus or Pro allowance. Team
grants multiply the per-seat allowance by the billed seat count.
Organization top-ups are available on organization-pooled plans in the
published 5,000, 20,000, and 50,000-credit packs. Purchased lots are added
directly to the organization pool, remain valid for 12 months, and are spent
after included credits.

Billable work reserves credits before it starts and settles once through an
idempotency key. Background jobs store the organization, initiating user,
resolved wallet owner, and reservation. For Team work, the resolved wallet is
the organization pool while the initiating user remains on the usage event.
Failed jobs release their reservation. A
completed operation can create debt, after which new work is blocked until the
wallet is positive.

Run `pnpm commerce:migrate` after the auth schema exists. Container entrypoints
do this automatically. Set `COMMERCIAL_OPERATOR_EMAILS` to grant the separate
platform-operator console at `/internal/commercial`; customer organization
owners do not inherit this access.

Recurring self-serve checkout and subscription changes use Razorpay Plans
published from Payload and verified again before checkout. Provider webhooks
activate, renew, change, complete, or cancel access idempotently. Organization
top-ups use one-time Razorpay Orders created from an immutable snapshot of the
published CMS pack. Taicho verifies the signed checkout response, provider order,
captured payment, amount, and currency. A signed `payment.captured` or
`order.paid` webhook can complete fulfillment when the browser callback is lost.
The payment session ID is also the purchased-lot idempotency key, so retries add
the credits once. Manual operator issuance remains available only as an audited
support action.
