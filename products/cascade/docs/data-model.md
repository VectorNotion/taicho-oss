# Data model

Cascade uses the `cascade` schema in shared Postgres. Generated Drizzle
migrations under `packages/database/migrations` are authoritative.

| Table | Purpose | Important fields |
|---|---|---|
| `funnels` | Named people list. | `id`, `name`, `organization_id` |
| `funnel_members` | Static membership linking one contact to one funnel. | `funnel_id`, `contact_id`, attribution fields |
| `plain_text_emails` | Named reusable literal-text email owned by a funnel. | `name`, `subject`, `body`, attribution fields |
| `contacts` | Nurture projection of a shared workspace person. | `email`, `attributes`, `workspace_contact_id` |

Membership is unique on `(funnel_id, contact_id)`. Email names are unique
within a funnel. Deleting a funnel cascades its memberships and text emails but
does not delete the shared contact.

The migration collapses historical enrollments into membership and preserves
valid historical email steps as named text emails. It then clears the retired
execution, delivery, template, and experiment data so no legacy state remains
active.
