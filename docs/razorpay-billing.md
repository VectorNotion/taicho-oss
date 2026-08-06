# Razorpay subscription and top-up billing

Payload CMS is the source of truth for Taicho's plans, entitlements, country prices,
payment-provider bindings, and organization top-up packs. Taicho detects the
visitor's country from Cloudflare and loads the published tenant catalog from
Payload. Subscription checkouts verify the selected amount, currency, and interval
against the bound Razorpay Plan. Top-up checkouts create a one-time Razorpay Order
from the exact published pack. The selected catalog version and commercial terms are
snapshotted before Razorpay Checkout opens.

Razorpay handles recurring and one-time payments and eligible payment methods. It
does not choose Taicho's country-specific prices. Publishing a CMS subscription
price creates or reuses the matching immutable Razorpay Plan automatically. Top-up
Orders are created on demand and use a unique receipt tied to the durable Taicho
payment session.

## Razorpay account setup

1. Complete Razorpay KYC, enable **Subscriptions**, and configure automatic payment
   capture for Orders. Credits are never fulfilled from an `authorized` payment;
   Taicho requires provider status `captured`.
2. Ask Razorpay Support to enable international debit and credit cards. Razorpay
   requires approved website Terms, Privacy, Refund/Cancellation, and Shipping
   policies before enabling international cards.
3. Install the Razorpay key ID and secret in both Payload CMS and the Taicho
   application. Do not create routine price revisions in the Razorpay Dashboard.
   Payload creates one Razorpay Plan for each published market price. Amounts are
   always the price for one billed user or seat in currency subunits; Razorpay
   Subscription `quantity` is the billed quantity.
4. Enable Cloudflare IP Geolocation so Cloudflare sends `CF-IPCountry` to the
   application origin. Keep the origin restricted to trusted Cloudflare traffic so
   clients cannot choose a cheaper country by supplying that header directly.
5. In Payload, enable the `billing` capability for the Taicho tenant, configure its
   default country and currency, and publish:

   - Billing Plans for product copy, credits, entitlements, and billing model.
   - Billing Prices for every supported country and currency. Choose whether an
     amount revision moves existing subscribers at cycle end or applies only to new
     customers.
   - Billing Top Ups for each supported country. Each record owns its code, credits,
     price in currency subunits, validity, and publication state.
   - Billing Promotions for trial extensions and subscription coupon rules. A
     discount promotion stores the matching environment-specific Razorpay Offer ID.

   Existing environment mappings can be imported once with
   `pnpm billing:import-razorpay` in the CMS repository. They are not used by the
   application afterward. New provider bindings are read-only in the CMS UI and
   maintained by the publication hook.
6. Create a webhook at:

   ```text
   https://cloud.taicho.ai/api/payments/razorpay/webhook
   ```

   Subscribe to:

   - `subscription.authenticated`
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.updated`
   - `subscription.pending`
   - `subscription.halted`
   - `subscription.paused`
   - `subscription.resumed`
   - `subscription.cancelled`
   - `subscription.completed`
   - `payment.captured`
   - `order.paid`

7. Install the API and webhook credentials:

   ```dotenv
   RAZORPAY_KEY_ID=rzp_live_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   RAZORPAY_SUBSCRIPTION_TOTAL_COUNT=120
   PAYLOAD_BILLING_CATALOG_URL=https://cms.example.com/api/billing/catalog
   PAYLOAD_BILLING_API_KEY=...
   PAYLOAD_BILLING_TENANT=taicho
   ```

8. Run the durable commerce worker:

   ```bash
   pnpm commerce:pricing-worker
   ```

   Production runs the same command in the `pricing-worker` image. In addition to
   applying scheduled pricing migrations, it reconciles unfulfilled one-time
   top-up Orders against Razorpay. This recovers captured payments when both the
   browser callback and webhook delivery are missed. The worker uses the commerce
   database and Razorpay key pair; it does not need CMS write access.

## Publishing a price revision

1. Edit the country price in Payload and save it as a draft. Draft changes do not
   reach Razorpay or either pricing UI.
2. Choose the existing-subscriber policy:
   - **Move at next renewal** creates a durable item for every active matching
     subscription.
   - **New customers only** preserves existing subscriptions on the old Plan.
3. Publish the price. Payload verifies the currently bound immutable Plan. If its
   amount, currency, or interval differs, Payload recovers or creates the exact new
   Razorpay Plan and stores the new Plan ID on the price.
4. Payload sends a signed catalog synchronization request to Taicho. Catalog reads
   independently detect the replacement as a recovery path if that notification is
   delayed.
5. The pricing worker claims migration items with database row locks and requests
   `schedule_change_at=cycle_end`. The item and local subscription are recorded as
   scheduled only after Razorpay accepts the update.
6. The signed `subscription.updated` or `subscription.charged` webhook applies the
   new commercial plan version locally and completes the rollout item.

The operator console at `/internal/commercial` shows queued, scheduled, applied,
blocked, and skipped counts. It can synchronize a market, process the queue
immediately, or retry exceptions. eMandate subscriptions and subscriptions with a
different pending change remain visible as exceptions; they are never silently
treated as migrated. Subscriptions with an active coupon also remain blocked until
the finite offer ends or Billing Operations coordinates a forever-offer change.

## Application flow

### Subscriptions

1. An organization owner chooses a paid plan.
2. Taicho sends `CF-IPCountry` to the protected Payload catalog endpoint. Payload
   uses the local market only when every self-serve plan has a matching Razorpay
   binding; otherwise the whole catalog uses the tenant's configured fallback market.
3. Taicho fetches each bound Razorpay Plan and refuses the catalog if its amount,
   currency, or interval differs from the published Payload price.
4. At checkout creation, Taicho fetches the selected Plan again and creates a
   short-lived, hashed checkout token that locks the Plan ID, billing country, amount,
   currency, exact Payload catalog version, provider Plan ID, and seat quantity.
5. Taicho validates the snapshotted amount, currency, and billing interval against
   Razorpay immediately before creating a bounded Subscription. Its authorization
   expiry matches
   the Taicho checkout expiry.
6. Standard Checkout returns the payment ID, subscription ID, and signature.
   Taicho verifies the signature using the server-side subscription ID.
7. Signed, idempotent webhooks activate and maintain product access. Checkout success
   alone does not grant access.
8. Customer cancellation is scheduled for the end of the current Razorpay billing
   cycle. Product access is removed when Razorpay emits `subscription.cancelled`.

Webhook signatures are calculated from the untouched request body. Duplicate
deliveries use `x-razorpay-event-id`, and terminal states are protected against late,
out-of-order activation events.

### Organization top-ups

1. An organization owner or administrator on an active organization-pooled plan
   chooses a published pack.
2. Taicho snapshots the CMS catalog version, pack code, credits, amount, currency,
   country, and validity into a short-lived session. Only one live top-up checkout
   is allowed per organization.
3. Taicho creates a Razorpay Order with the snapshotted amount and currency and a
   unique deterministic receipt. Before creating a replacement after an interrupted
   request, it recovers an existing Order by that receipt.
4. Standard Checkout receives the server-created `order_id`, amount, and currency.
   It returns the payment ID, order ID, and signature.
5. Taicho verifies the signature using the server-side order ID, then fetches the
   Order and Payment from Razorpay. Fulfillment requires the exact order, exact
   amount and currency, Order status `paid`, and Payment status `captured`.
6. The captured payment inserts one provider transaction and one purchased credit
   lot into the organization pool. The lot is valid for the CMS-configured period
   (currently 365 days). Its unique grant key is derived from the payment session,
   making browser retries and webhook retries idempotent.
7. A signed `payment.captured` or `order.paid` webhook performs the same transaction
   when the browser callback is lost. Duplicate event IDs and duplicate payment
   evidence cannot add credits twice.

### Subscription coupons and promotional trials

Payload publishes versioned promotion rules through billing catalog version 3.
Taicho quotes and reserves a coupon before creating the provider Subscription,
then passes the bound Razorpay `offer_id` for a discount or a future `start_at`
for a trial. Signed subscription webhooks consume the reservation and record the
list amount, discount, captured amount, and promotion version. See
[Promotions and coupons](./promotions-and-coupons.md) for the CMS contract and
operator workflow.

## Test-mode checklist

- Use test API keys and test Plan IDs together; never mix test and live IDs.
- Send `CF-IPCountry: IN` and confirm the pricing page and checkout show the INR Plan.
- Test another configured country and an unconfigured country; the latter must use
  the Taicho tenant's default country from Payload.
- Complete a subscription authorization with Razorpay's test card details.
- Confirm the checkout session moves from `checkout_ready` to `processing`, then
  `paid` after the activation webhook.
- Replay the same webhook event ID and confirm it is treated as a duplicate.
- Send a payload with a modified body or signature and confirm it is rejected.
- Schedule cancellation and confirm access remains until the cancellation event.
- Publish a changed test price and confirm a new test Plan is bound, the rollout is
  visible in Commercial Operations, and the subscription is scheduled at cycle end.
- Exercise an eMandate fixture and confirm it is reported as a blocked exception.
- Buy every published top-up pack and confirm the checkout amount/currency match the
  CMS snapshot and the organization pool receives the exact credits.
- Disable/hold capture and confirm an `authorized` payment never grants credits;
  restore capture and confirm `payment.captured` or `order.paid` fulfills it once.
- Close the browser after payment and confirm webhook-only fulfillment. Replay the
  callback and both webhook event types and confirm the lot and transaction counts
  remain one.
- Send a correctly signed callback whose fetched provider amount, currency, payment
  ID, or order ID differs and confirm fulfillment fails closed.
- Repeat the flow with a foreign-issued test card after international payments are
  enabled on the account.

## Official references

- [Subscriptions overview](https://razorpay.com/docs/payments/subscriptions/)
- [Create subscriptions and international-currency Plans](https://razorpay.com/docs/payments/subscriptions/create/)
- [Subscription integration guide](https://razorpay.com/docs/payments/subscriptions/integration-guide/)
- [Create a Plan API](https://razorpay.com/docs/api/payments/subscriptions/create-plan/)
- [Plans entity fields](https://razorpay.com/docs/api/payments/subscriptions/plans-entity/)
- [Create a Subscription API](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/)
- [Subscription webhook events](https://razorpay.com/docs/webhooks/subscriptions/)
- [Standard Checkout Orders integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Create an Order API](https://razorpay.com/docs/api/orders/create/)
- [Fetch a Payment API](https://razorpay.com/docs/api/payments/fetch-with-id/)
- [Order webhook events](https://razorpay.com/docs/webhooks/orders/)
- [Payment webhook events](https://razorpay.com/docs/webhooks/payments/)
- [Validate and test webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [International debit and credit cards](https://razorpay.com/docs/payments/international-payments/international-debit-credit-cards/)
- [Cloudflare `CF-IPCountry` header](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-ipcountry)
- [Cloudflare IP Geolocation](https://developers.cloudflare.com/network/ip-geolocation/)
