# Intelligence workflows and external orchestration

Vector Notion owns intelligence, human decisions, and structured artifacts. It does not own campaign timing, provider delivery, retries, or channel credentials. Those execution concerns belong to n8n or another external orchestrator.

## Runtime shape

1. A trusted connector submits a normalized business event, such as `lead.created`.
2. The signed ingress records the event with `external_connector` origin and a durable delivery ID.
3. The deterministic event policy creates an attention item only when a human decision is useful, then creates a recipient row for each workspace member whose in-app preference allows that category.
4. A global in-app host reads the durable inbox and uses SSE only as a low-latency wake-up signal. UI and internal-system events remain quiet.
5. The user opens the attention item in the sole workspace Chat. Chat receives its suggested prompt and structured workflow input.
6. Chat invokes a fixed, permission-checked intelligence workflow. It does not select a Squad or construct an automation.
7. The workflow stores a run and one structured artifact, then marks that user's notification as acted.
8. An external orchestrator retrieves the artifact, performs delivery if needed, and reports the outcome.

The workflow keys are a versioned product contract. They are not user-authored definitions:

| Workflow | Artifact | Current executable slice |
| --- | --- | --- |
| `knowledge_research` | `research_brief` | Contract defined; existing research capability is the migration source |
| `content_intelligence` | `content_package` | Contract defined; ideas, outline/refinement, draft, and future media capabilities are the migration source |
| `audience_resonance` | `audience_evaluation` | Contract defined; the current asynchronous Resonance run is the migration source |
| `lead_intelligence` | `lead_dossier` | Available: lead research followed by qualification |
| `outreach_intelligence` | `outreach_message` | Available: grounded message artifact; never sends it |
| `funnel_intelligence` | `funnel_recommendation` | Contract defined; funnel state stays internal while delivery stays external |
| `feedback_intelligence` | `feedback_recommendation` | Contract defined; consumes outcomes reported by external systems |

The first complete vertical slice is:

`lead.created` → attention item → Chat → `lead_intelligence` → lead dossier → `lead.qualified` → attention item → `outreach_intelligence` → outreach artifact → n8n delivery → outcome report

## Artifact contract

Every canonical workflow is assigned one artifact kind. Stored artifacts contain:

- workflow and kind;
- title, summary, and structured content;
- source references;
- recommended next actions;
- provenance and workflow version;
- organization, run, status, and timestamps.

An artifact is the handoff boundary. Recommendations may tell n8n what should happen next, but the intelligence workflow does not send a message or publish content.

## n8n API v1

An organization owner or administrator can obtain the organization ID, token, paths, and signing metadata with an authenticated browser request:

- `GET /api/intelligence/v1/token` gets or creates the current token.
- `POST /api/intelligence/v1/token` rotates it.

Treat the returned token as a secret and place it in n8n credentials. Do not put it in workflow JSON, logs, query parameters, or item data.

External endpoints:

- `POST /api/intelligence/v1/events` records a normalized external business event. The current contract accepts `lead.created` and `content.angle.emerged`.
- `POST /api/intelligence/v1/workflows/{workflow}` triggers a canonical workflow.
- `GET /api/intelligence/v1/runs/{runId}` retrieves the run and its artifact when ready.
- `GET /api/intelligence/v1/artifacts/{artifactId}` retrieves one artifact.
- `POST /api/intelligence/v1/outcomes` reports an externally observed outcome.
- `GET /api/intelligence/v1/notifications?after={cursor}` exposes the channel-neutral attention feed for n8n-owned Slack or WhatsApp delivery.

All requests use these headers:

- `x-intelligence-organization-id`
- `x-intelligence-timestamp`
- `x-intelligence-signature`
- `idempotency-key` (preferred) or `x-intelligence-delivery-id`

The timestamp is Unix seconds. It must be within five minutes. The delivery ID is part of both the signature and the durable idempotency contract.

Build the signature from the exact raw request body:

```text
canonical = UPPERCASE_METHOD + "\n" + PATHNAME + "\n" + RAW_BODY
signature = "v1=" + hex(HMAC_SHA256(token, timestamp + "." + deliveryId + "." + canonical))
```

An n8n Code node can generate the signing headers:

```js
const crypto = require('crypto');

const token = $credentials.intelligenceApi.token;
const organizationId = $credentials.intelligenceApi.organizationId;
const method = 'POST';
const path = '/api/intelligence/v1/workflows/lead_intelligence';
const rawBody = JSON.stringify({ input: { leadId: $json.leadId } });
const timestamp = String(Math.floor(Date.now() / 1000));
const deliveryId = $execution.id + ':lead-intelligence';
const canonical = `${method}\n${path}\n${rawBody}`;
const signature = 'v1=' + crypto
  .createHmac('sha256', token)
  .update(`${timestamp}.${deliveryId}.${canonical}`)
  .digest('hex');

return [{ json: {
  rawBody,
  headers: {
    'content-type': 'application/json',
    'x-intelligence-organization-id': organizationId,
    'x-intelligence-timestamp': timestamp,
    'x-intelligence-signature': signature,
    'idempotency-key': deliveryId,
  },
} }];
```

Send `rawBody` unchanged in the following HTTP Request node. Reusing the same delivery ID for the same workflow returns the completed run and artifact instead of executing twice. A still-running duplicate returns `202` with the existing run.

Example outcome body:

```json
{
  "artifactId": "03c7b8d4-f88c-4cf8-9014-c84fd76168c6",
  "status": "replied",
  "channel": "email",
  "externalRef": "provider-message-id",
  "metrics": { "replyCount": 1 },
  "occurredAt": "2026-08-02T07:30:00.000Z"
}
```

Outcome delivery IDs are also idempotent. Reporting the same external event twice returns the original outcome.

Example normalized event body:

```json
{
  "name": "lead.created",
  "connectorId": "hubspot",
  "leadId": "lead_123",
  "payload": {
    "name": "Aisha Patel",
    "company": "Northstar",
    "source": "hubspot"
  }
}
```

The connector must first persist or resolve the referenced business entity, then submit the event. Reusing the same delivery ID and event name returns the original event and does not create another attention item or recipient notification. Authenticated MCP mutations are also marked as external connector work automatically; browser and Chat mutations retain the default internal origin.

## In-app notification controls

The profile page contains per-user in-app controls for all external activity and for these categories:

- leads;
- content insights and angles;
- externally requested workflow results;
- outcomes reported by external systems.

Missing preference rows mean enabled. Turning a category off affects future projections for that user; it does not delete historical inbox rows. Notification lifecycle is also per user: unread, seen, dismissed, and acted states never dismiss another workspace member's copy.

## Deliberate boundaries

- Chat is an interface adapter and dispatcher, not a multi-agent workflow engine.
- Internal agents and tools may execute steps inside a canonical workflow, but they are not user-managed Squad members.
- Only signed `external_connector` business events can become assistant notifications. Browser UI, Chat, workers, and ordinary internal product events are explicitly suppressed.
- Publishing, email delivery, schedules, retries, WhatsApp, Slack, and provider authentication stay outside the intelligence layer.
- Funnel membership and state remain first-party intelligence inputs even when content delivery is external.
