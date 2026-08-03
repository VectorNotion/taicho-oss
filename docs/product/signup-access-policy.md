# Launch signup and access policy

Status: launch baseline selected; named Product and Security approval pending
Launch policy: waitlist-only
Technical owner: Codex
Decision date: 25 July 2026

## Decision

Taicho will not offer public self-service account creation at launch. Existing
customers sign in normally. A new team uses the public **Request access** path,
which creates a rate-limited enterprise inquiry for operator follow-up. Account
and workspace provisioning remains an operator-controlled process during the
launch window.

This is the only policy compatible with the current product and security
state. Email verification, an approved bot challenge, deliverability controls,
and a rehearsed self-service recovery journey are not yet complete. Calling
the launch behavior “open signup” would therefore be inaccurate and unsafe.

## Enforcement

The policy is enforced at independent boundaries:

- `AUTH_SIGNUP_POLICY=waitlist` is required by the production preflight.
- Production startup rejects an explicit `open` policy instead of silently
  enabling it.
- Better Auth sets `disableSignUp` whenever the effective policy is not open.
- Nginx returns `403 SIGNUP_WAITLIST` for the exact email-signup endpoint.
- The sign-in UI removes the create-account tab and links new teams to the
  public access-request form.
- Email signup remains available only in local development when explicitly set
  to `open`, so the flow can be tested without weakening production.

The active production environment file contains the waitlist policy and the
live edge rejects the signup endpoint. The currently running legacy container
was created before that variable was added, and its sign-in page does not yet
show the candidate access-policy copy. The edge remains fail-closed; recreating
the app from the immutable candidate will align the running UI and server.

## Reopening public signup

Changing production to open signup requires a new reviewed change, not an
environment-only toggle. Product and Security must approve all of the
following evidence:

1. verified-email enrollment and recovery work end to end;
2. bot protection and accessible fallback behavior are tested;
3. layered rate limits, enumeration resistance, and abuse alerts pass;
4. onboarding, tenant creation, billing, support, deletion, and export
   journeys are ready for an unaided customer;
5. support capacity and launch-abort thresholds are assigned;
6. the production preflight, application guard, edge rule, and UI are changed
   together in one release candidate.

## Launch acceptance

Before closing UX-04:

- Product and Security record named approval of this waitlist decision.
- The immutable candidate is deployed.
- The live sign-in page exposes no create-account control and displays the
  request-access path.
- A direct live email-signup request is denied without creating a user.
- A realistic access request is stored once and visible to the assigned
  operator, with the submitter receiving the agreed follow-up.
