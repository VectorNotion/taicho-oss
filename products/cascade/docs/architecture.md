# Architecture

Cascade is an organization-scoped CRUD package used directly by the unified
Next.js app, the capability API, and MCP.

```text
UI / REST / MCP / n8n
          |
          v
Cascade repositories
          |
          v
Postgres: funnels + funnel_members + plain_text_emails + contacts
```

There is no execution process between a write and a read. A membership exists
as soon as it is added. A text email exists as soon as it is saved.

Cascade owns list membership and literal email text. It does not own workflow
steps, timing, routing, preparation, personalization, rendering, sending,
tracking, provider credentials, or delivery results. External automation owns
those concerns.

Every current table is protected by organization RLS. Membership and email
rows carry actor/request/trace attribution fields for writes that provide it.
