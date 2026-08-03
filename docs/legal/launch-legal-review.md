# Taicho launch legal review

Status: **DRAFT — NOT APPROVED FOR PUBLIC LAUNCH**
Prepared: 25 July 2026

## Customer document set

The unified application now exposes a public `/legal` hub with:

- Privacy Policy;
- Terms of Service;
- Subprocessor Notice;
- Data Processing Addendum;
- AI Disclosure;
- Data Retention, Deletion, and Export Policy;
- Acceptable Use Policy; and
- Cookie and Telemetry Notice.

Draft pages emit `noindex, nofollow`, display their review status, and are
linked from every public page and the authenticated sidebar. The application
does not claim the documents are effective until
`LEGAL_DOCUMENT_STATUS=approved`.

## Fail-closed release contract

The production validator requires:

- approved document status;
- legal entity and registered address;
- legal and privacy contact addresses;
- effective date and launch markets;
- infrastructure provider and data-hosting location; and
- an approved AI-provider data-use statement.

The current production environment intentionally lacks approved values, so the
release gate remains closed.

## Product facts verified in the drafts

- Current browser storage is limited to authentication, OAuth state/PKCE,
  anonymous support continuity, and sidebar preference.
- No advertising, cross-site analytics, or session-replay cookie was found.
- Datadog and Langfuse exporters filter sensitive content, but their production
  credentials and contracts are not launch-ready.
- OpenRouter is active; OpenAI embeddings, Tavily, Qdrant, Resend, Datadog, and
  Langfuse are not fully launch-configured.
- CRM credentials are encrypted with tenant-bound associated data.
- Customer export and deletion workflows are not launch-ready, and the draft
  policy says so rather than promising unsupported behavior.
- Backup retention, off-host storage, and restore exercises remain open.

## Required approval record

Counsel and the accountable product owner must complete this table without
placing personal data or contract-confidential text in the repository:

| Approval | Named approver | Date | Evidence / contract ID |
| --- | --- | --- | --- |
| Legal entity, address, markets, governing terms |  |  |  |
| Privacy notice and request channel |  |  |  |
| DPA, transfer mechanism, and security annex |  |  |  |
| Subprocessors, regions, contracts, and notice period |  |  |  |
| AI provider retention/training position |  |  |  |
| Retention, deletion, export, and legal-hold schedule |  |  |  |
| Acceptable use and enforcement/appeal terms |  |  |  |
| Cookie and telemetry consent behavior |  |  |  |

SEC-09 may close only after every row is approved, the environment contract is
filled, the candidate renders approved/indexable pages, and the linked support
and privacy channels are tested.
