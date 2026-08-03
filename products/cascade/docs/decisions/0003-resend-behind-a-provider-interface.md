# ADR 0003 — Resend as transport, behind a provider interface

**Status:** Accepted (founding proposal, July 2026)

## Context

We need a transport with good deliverability and a simple API, without coupling the platform to it. We own contacts, suppression, and event history ourselves.

## Decision

Send through **Resend**, used as pure transport behind a provider abstraction, with **SES** as the fallback implementation behind the same interface. Contacts, suppression, and events live in our Postgres, not in Resend. The provider receives finished HTML only.

The interface follows the mailer abstraction already proven in `editorial-automation` (`packages/mailers/`: a `Mailer` base class with per-provider implementations behind a registry).

## Consequences

- Lock-in is shallow: Resend runs on AWS SES, so DKIM/SPF point at amazonses.com and deliverability is inherited from SES. Switching to raw SES is a DNS change plus an SDK swap with the same deliverability profile.
- Cost exit path: Resend ≈ $0.40 per 1,000 sends, SES ≈ $0.10 per 1,000. At 500k/month that is roughly $300 vs $50 — switch when volume makes the delta matter.
- The send call must stay thin and wrappable; no provider-specific features (Resend templates, Resend audiences) may leak into the engine.
