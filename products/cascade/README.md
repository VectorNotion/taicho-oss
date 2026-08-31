# Cascade — funnel lists and plain-text emails

Cascade is deliberately simple: a funnel is a named list of people plus a set
of named plain-text emails. The UI, REST API, capability API, and MCP tools all
perform direct CRUD against the same data.

Cascade does not sequence work, wait, branch, schedule, prepare recipient
outboxes, send email, track delivery, or run a worker. n8n or another external
system can read funnel members and text emails and own all delivery behavior.

## Active data

- `funnels` — the named list.
- `funnel_members` — contacts included in that list.
- `plain_text_emails` — `name`, `subject`, and literal `body` owned by a funnel.
- `contacts` — the Nurture projection of the shared workspace person.

The derived `content` field is only a convenient text representation:

```text
Subject: A complete subject

The literal body.
```

No merge tags are interpreted. HTML-like text remains text.

## Surfaces

- `/cascade` lists funnels.
- `/cascade/funnels/:id` manages people and named text emails.
- `/api/v1/cascade/*` (capability registry, `packages/capabilities/catalog-cascade.ts`)
  and MCP expose the same CRUD to the UI and to automation.

Run `pnpm db:migrate`, `pnpm cascade:seed`, and `pnpm test:cascade` from the
repository root. There is no Cascade worker command or service.
