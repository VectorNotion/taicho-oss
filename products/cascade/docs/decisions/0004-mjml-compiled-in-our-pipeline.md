# ADR 0004 — MJML templates, compiled in our pipeline

**Status:** Accepted (founding proposal, July 2026)

## Context

Email HTML is hostile (Outlook rendering, CSS support fragmentation). Providers differ in what they ingest — Resend takes HTML, not MJML. Templates must outlive any provider.

## Decision

Author templates in **MJML** with typed, named slots. Compile MJML → email-safe HTML in our own pipeline and cache the result. Merge per-contact variables at send time with **Handlebars**. Inline CSS and generate a text/plain part during compose. The provider only ever receives finished HTML.

## Consequences

- Templates are portable across providers because no provider renders anything.
- MJML has the strongest cross-client compatibility record, including all Outlook versions.
- The compile step is a natural validation point: a template that doesn't compile can never become send-eligible.
- The slot model is the interface between the template agent (produces layout) and the content agent (fills slots) — inherited from `editorial-automation`'s template editor.
