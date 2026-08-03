# Deliverability runbook

Operational checklist for taking Cascade's sending live. The code side (RFC 8058 headers, suppression gate, tracking) shipped with Phase 2/3; everything below needs accounts, DNS, and a domain decision — it cannot be automated from this repo. Work through it before the first real send.

## 1. Domain and identity

- [ ] Pick a **dedicated sending subdomain** (e.g. `mail.yourdomain.com`). Never send marketing from the root domain.
- [ ] Decide the sender name and address recipients should see.
- [ ] Set `CASCADE_PUBLIC_URL` to the public HTTPS host serving the cascade worker's HTTP port (unsubscribe/tracking links must be HTTPS in production).
- [ ] Install a dedicated `CASCADE_CREDENTIAL_ENCRYPTION_KEY` generated with
  `openssl rand -base64 32`; record its
  `CASCADE_CREDENTIAL_ENCRYPTION_KEY_VERSION` and rotation owner.

## 2. Provider + DNS records

- [ ] Create the Resend, Twilio SendGrid, or Mailchimp Transactional account
  and connect its API key plus sender in **Nurture → Settings**. Secrets must
  not be copied into `.env`; Nurture configures signed event tracking itself.
- [ ] Publish the DKIM and SPF records shown in the provider dashboard for the
  sender domain Nurture derived from the address.
- [ ] DMARC: publish `_dmarc.mail.yourdomain.com` with at least `v=DMARC1; p=none; rua=mailto:...` and tighten to `quarantine` once reports are clean. Alignment must pass for both SPF and DKIM.
- [ ] Use **Check again** until the connected service shows **Ready to send**.
  Nurture automatically promotes the selected sender for funnel delivery once
  provider verification passes.
- [ ] Confirm the connected-service row reports that delivery tracking is
  connected. Nurture creates the workspace-specific signed webhook through the
  provider API.

## 3. Compliance monitoring (day one, not later)

- [ ] **Google Postmaster Tools v2** — add the subdomain; v2 (since October 2025) reports binary pass/fail compliance status.
- [ ] **Yahoo Complaint Feedback Loop** — register the subdomain.
- [ ] Verify one-click unsubscribe headers land intact: send to a Gmail seed account, check "Unsubscribe" appears next to the sender, click it, and confirm the contact flips to `unsubscribed` within seconds (the code path is `POST /u/:token`).

## 4. Operating thresholds (hard rules)

- Complaint rate **< 0.1%**; never touch **0.3%** — exceeding it loses mitigation support until 7 straight days back under.
- **5,000+ emails/day** to Gmail/Yahoo/Microsoft consumer domains triggers bulk-sender classification — permanent once hit. Plan volume ramp-up gradually (warm the subdomain: hundreds/day for ~2 weeks before thousands).
- Unsubscribes must process within 48 hours; Cascade processes them instantly, so any delay is an ops failure (worker down = unsubscribe endpoint down — monitor `/healthz`).

## 5. Pre-launch verification

- [ ] `pnpm test:cascade` green.
- [ ] Seed a test funnel to a personal seed list across Gmail/Outlook/Yahoo; verify inbox placement, rendering (MJML), working unsubscribe, and tracking pixel/click events arriving in `events`.
- [ ] Confirm bounces from a nonexistent address produce a `bounce` event and suppression via the webhook.
