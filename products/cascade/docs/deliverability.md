# Deliverability requirements

These are current rules (as of the July 2026 proposal), not general advice. The code side is built in — shipped with Phase 2 of the [roadmap](roadmap.md): RFC 8058 headers on every send, the suppression gate at enqueue and transport, instant unsubscribe processing — and treated as hard constraints by the engine. The DNS/monitoring side is operational work: see the [runbook](deliverability-runbook.md).

## Thresholds and mandates

- **Bulk-sender threshold:** 5,000+ emails per day to Gmail or Yahoo consumer addresses triggers bulk-sender rules; the classification is permanent once hit. Microsoft added parallel rules for Outlook/Hotmail/Live in May 2025 at the same 5,000/day threshold.
- **Authentication:** SPF, DKIM, and DMARC alignment required.
- **Unsubscribe:** RFC 8058 one-click unsubscribe (POST, processed within 48 hours). Applies to marketing mail only, not transactional.
- **Spam complaint rate:** keep under **0.1%**. Never hit **0.3%** — exceeding it loses mitigation support until 7 straight days back under.

## Operational rules

- Send from a **dedicated subdomain**.
- Enforce the **suppression gate** hard — mandatory check of unsubscribes, complaints, and hard bounces before every send, no exceptions.
- Wire up **Google Postmaster Tools** and the **Yahoo Complaint Feedback Loop** from day one. Postmaster Tools v2 (since October 2025) reports a binary pass/fail compliance status rather than reputation scores.

## Interaction with the closed loop

High content variance works against inbox placement. The loop bounds variance by generating at the segment level and capping arms at 2–4 per step per segment — see [closed-loop.md](closed-loop.md).
