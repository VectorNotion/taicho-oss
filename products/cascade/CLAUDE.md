# Cascade contributor notes

Cascade is direct CRUD for named people lists and named plain-text emails.

- Funnel membership is static until UI/API/MCP changes it.
- Email `name`, `subject`, and `body` are literal stored text.
- Do not introduce steps, ordering, waits, branches, goals, schedulers, workers,
  outboxes, rendering, templates, provider SDKs, send loops, or delivery state.
- External automation such as n8n owns all email delivery behavior.

Runtime data is Postgres under the `cascade` schema with organization RLS.
Product UI and route handlers live in `apps/unified/app/cascade` and
`apps/unified/app/api/cascade`.

Run `pnpm --filter @content-automation/cascade typecheck` and
`pnpm test:cascade`. Database changes require generated Drizzle migrations and
must retain RLS plus actor/request/trace attribution.
