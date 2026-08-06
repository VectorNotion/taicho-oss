# Promotions and coupons

Payload owns promotion configuration. Taicho owns checkout-time validation,
redemption limits, immutable snapshots, financial verification, and audit history.
Razorpay owns the recurring invoice calculation for discount offers.

## Supported promotions

- `trial`: adds 1–90 days to an organization's initial trial and creates the
  paid Razorpay Subscription with `start_at` equal to the extended trial end.
  The original trial credit amount is not replenished.
- `discount`: applies a flat or percentage Razorpay Subscription Offer for one
  payment, a limited number of successful payments, or the lifetime of that
  specific subscription.

Only one promotion can be attached to a subscription. Self-serve plan changes
and automated price rollouts are blocked while a promotion is active. Finite
offers can be retried after their last discounted payment; forever offers need
Billing Operations to coordinate the provider offer and Plan change. Coupons
are available only for new subscription checkout; existing-subscriber
retention offers require an operator-assisted workflow because Razorpay applies
offer changes at a billing cycle boundary.

## Payload catalog contract

Payload publishes catalog version `3`. Versions `1` and `2` remain valid and
are interpreted as catalogs with no promotions. The protected catalog response
adds a `promotions` array:

```json
{
  "version": "3",
  "catalogVersion": "<64-character sha256>",
  "requestedCountry": "IN",
  "pricingCountry": "IN",
  "provider": "razorpay",
  "environment": "live",
  "defaultCurrency": "INR",
  "plans": [],
  "topUps": [],
  "promotions": [
    {
      "id": "welcome-50",
      "payloadPromotionId": "<payload document id>",
      "payloadUpdatedAt": "2026-08-05T00:00:00.000Z",
      "name": "Welcome 50",
      "description": "50% off the first three payments.",
      "code": "WELCOME50",
      "kind": "discount",
      "trialDays": null,
      "discountType": "percentage",
      "percentOffBasisPoints": 5000,
      "amountOffMinor": null,
      "maximumDiscountMinor": null,
      "currency": "INR",
      "duration": "repeating",
      "durationCycles": 3,
      "eligiblePlanIds": ["plus", "pro", "team"],
      "startsAt": "2026-08-05T00:00:00.000Z",
      "endsAt": "2026-12-31T23:59:59.000Z",
      "newCustomersOnly": true,
      "maxRedemptions": 1000,
      "perOrganizationLimit": 1,
      "active": true,
      "provider": {
        "name": "razorpay",
        "externalOfferId": "offer_00000000000000",
        "environment": "live"
      }
    }
  ]
}
```

Trial promotions use `kind: "trial"`, a positive `trialDays`, and
`provider: null`. Discount-only fields must be `null`. Discount promotions must
provide exactly one applicable discount value:

- `percentage`: `percentOffBasisPoints` from 1 through 10,000.
- `fixed`: `amountOffMinor` in the currency's minor units.

`maximumDiscountMinor` is optional for percentage promotions. A `repeating`
promotion requires `durationCycles` of at least 2. `once` and `forever` use a
null cycle count. Taicho rejects a quote unless the post-discount charge is
greater than one whole currency unit, matching Razorpay's Subscription Offer
minimum-charge rule.

Codes are normalized to uppercase and stored in Taicho only as SHA-256 digests.
The catalog endpoint is already protected with `PAYLOAD_BILLING_API_KEY`; coupon
codes must never be included in the public pricing response or client bundles.

## Razorpay setup

For every discount promotion and environment:

1. Create the matching Subscription Offer in the Razorpay Dashboard.
2. Match discount type, amount/percentage, duration, cycle count, currency,
   eligible plans, payment methods, and validity window to Payload.
3. Store the resulting `offer_id` in the Payload promotion's provider binding.
4. Publish the promotion and verify the Taicho checkout quote in test mode.

Trial promotions do not use Razorpay Offers. Taicho supplies the snapshotted
trial end through the Subscription `start_at` parameter.

## Redemption lifecycle

1. Checkout loads without creating a provider Subscription.
2. A coupon quote validates dates, plan, currency, new-customer eligibility,
   per-organization use, and global capacity without consuming the coupon.
3. Continuing to Razorpay locks the promotion version and reserves a redemption
   until the checkout session expires.
4. Taicho passes the snapshotted `offer_id` or `start_at` to Razorpay.
5. A signed `subscription.activated` or `subscription.charged` webhook applies
   a discount redemption. A signed `subscription.authenticated` webhook applies
   a trial redemption and extends the local trial.
6. Captured transactions record list amount, discount amount, charged amount,
   promotion ID, and promotion version.

Duplicate provider events and payment IDs remain idempotent. An expired
reservation no longer counts against either redemption limit. Consumed coupons
are not restored when a subscription is cancelled.

## Emergency controls

Publish the promotion with `active: false` to disable all locally materialized
versions for new checkout. Also disable the Razorpay Offer so the provider fails
closed if a stale checkout reaches it. Existing successfully applied recurring
offers remain part of their subscription contract unless Billing Operations
explicitly schedules their removal.
