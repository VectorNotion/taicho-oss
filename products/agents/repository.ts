import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getSession } from '@content-automation/platform/data/graph';
import {
  agentChannelSchema,
  agentDefinitionInputSchema,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDeployment,
  type AgentWithDeployments,
  publicDeployment,
} from './domain';

const DEFINITION_LABEL = 'AgentDefinitionV1';
const DEPLOYMENT_LABEL = 'AgentDeploymentV1';

function slug(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'agent';
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function recordJson<T>(record: { get(key: string): unknown }, key = 'json'): T {
  const raw = record.get(key);
  return JSON.parse(typeof raw === 'string' ? raw : String(raw)) as T;
}

export function stripLegacyAgentModelKey(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { modelKey: _legacyModelKey, ...definition } = value;
  return definition;
}

function agentRecord(record: { get(key: string): unknown }): AgentDefinition {
  const value = recordJson<AgentDefinition>(record);
  const definition = stripLegacyAgentModelKey(
    value as unknown as Record<string, unknown>,
  ) as unknown as AgentDefinition;
  const channels = Array.isArray(value.channels)
    ? value.channels.filter((channel) => agentChannelSchema.safeParse(channel).success)
    : [];
  return {
    ...definition,
    channels: channels.length > 0 ? channels : ['api-sdk'],
  };
}

/** Count stored legacy definitions before and after the one-time rewrite. */
export async function countLegacyAgentModelKeys(organizationId: string): Promise<number> {
  return sessionFor(organizationId, async (session) => {
    const result = await session.run(
      `MATCH (n:${DEFINITION_LABEL} {organizationId: $organizationId})
       WHERE n.json CONTAINS '\"modelKey\"'
       RETURN count(n) AS count`,
      { organizationId },
    );
    const count = result.records[0]?.get('count');
    return Number(count?.toString?.() ?? count ?? 0);
  });
}

/** Rewrite persisted JSON without the retired modelKey field. Safe to rerun. */
export async function migrateLegacyAgentModelKeys(organizationId: string): Promise<number> {
  return sessionFor(organizationId, async (session) => {
    const result = await session.run(
      `MATCH (n:${DEFINITION_LABEL} {organizationId: $organizationId})
       WHERE n.json CONTAINS '\"modelKey\"'
       RETURN n.id AS id, n.json AS json`,
      { organizationId },
    );
    for (const record of result.records) {
      const id = String(record.get('id'));
      const raw = JSON.parse(String(record.get('json'))) as Record<string, unknown>;
      const definition = stripLegacyAgentModelKey(raw);
      await session.run(
        `MATCH (n:${DEFINITION_LABEL} {id: $id, organizationId: $organizationId})
         SET n.json = $json
         RETURN n.id AS id`,
        { id, organizationId, json: JSON.stringify(definition) },
      );
    }
    return result.records.length;
  });
}

async function sessionFor<T>(organizationId: string, run: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>): Promise<T> {
  const session = await getSession(organizationId);
  try { return await run(session); } finally { await session.close(); }
}

async function putNode(organizationId: string, label: string, value: AgentDefinition | AgentDeployment) {
  await sessionFor(organizationId, (session) => session.run(
    `MERGE (n:${label} {id: $id, organizationId: $organizationId})
     SET n.json = $json, n.slug = $slug, n.agentId = $agentId, n.status = $status, n.updatedAt = $updatedAt
     RETURN n.id AS id`,
    {
      id: value.id,
      organizationId,
      json: JSON.stringify(value),
      slug: 'slug' in value ? value.slug : null,
      agentId: 'agentId' in value ? value.agentId : null,
      status: value.status,
      updatedAt: value.updatedAt,
    },
  ));
}

export async function listAgents(organizationId: string): Promise<AgentWithDeployments[]> {
  return sessionFor(organizationId, async (session) => {
    const [definitions, deployments] = await Promise.all([
      session.run(`MATCH (n:${DEFINITION_LABEL} {organizationId: $organizationId}) RETURN n.json AS json ORDER BY n.updatedAt DESC`, { organizationId }),
      session.run(`MATCH (n:${DEPLOYMENT_LABEL} {organizationId: $organizationId}) RETURN n.json AS json ORDER BY n.updatedAt DESC`, { organizationId }),
    ]);
    const deploymentValues = deployments.records.map((record) => recordJson<AgentDeployment>(record));
    return definitions.records.map((record) => {
      const agent = agentRecord(record);
      return { agent, deployments: deploymentValues.filter(({ agentId }) => agentId === agent.id).map(publicDeployment) };
    });
  });
}

export async function getAgent(organizationId: string, idOrSlug: string): Promise<AgentDefinition | null> {
  return sessionFor(organizationId, async (session) => {
    const result = await session.run(
      `MATCH (n:${DEFINITION_LABEL} {organizationId: $organizationId}) WHERE n.id = $value OR n.slug = $value RETURN n.json AS json LIMIT 1`,
      { organizationId, value: idOrSlug },
    );
    return result.records[0] ? agentRecord(result.records[0]) : null;
  });
}

export async function createAgent(organizationId: string, createdBy: string, raw: AgentDefinitionInput): Promise<AgentDefinition> {
  const input = agentDefinitionInputSchema.parse(raw);
  const existing = await listAgents(organizationId);
  const baseSlug = slug(input.name);
  let valueSlug = baseSlug;
  let suffix = 2;
  while (existing.some(({ agent }) => agent.slug === valueSlug)) valueSlug = `${baseSlug}-${suffix++}`;
  const now = new Date().toISOString();
  const value: AgentDefinition = {
    ...input,
    projectionKeys: [...new Set(input.projectionKeys)],
    allowedUses: [...new Set(input.allowedUses)],
    id: randomUUID(),
    organizationId,
    slug: valueSlug,
    version: 1,
    status: 'active',
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await putNode(organizationId, DEFINITION_LABEL, value);
  return value;
}

export async function updateAgent(input: {
  organizationId: string;
  agentId: string;
  expectedUpdatedAt?: string;
  changes: Partial<AgentDefinitionInput> & { status?: 'active' | 'paused' };
}): Promise<AgentDefinition> {
  const current = await getAgent(input.organizationId, input.agentId);
  if (!current) throw new Error('Agent not found.');
  if (input.expectedUpdatedAt && current.updatedAt !== input.expectedUpdatedAt) throw new Error('Agent changed since it was read.');
  const parsed = agentDefinitionInputSchema.parse({ ...current, ...input.changes });
  const configurationChanged = Object.keys(input.changes).some((key) => key !== 'status');
  const value: AgentDefinition = {
    ...current,
    ...parsed,
    projectionKeys: [...new Set(parsed.projectionKeys)],
    allowedUses: [...new Set(parsed.allowedUses)],
    status: input.changes.status ?? current.status,
    version: current.version + (configurationChanged ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
  await putNode(input.organizationId, DEFINITION_LABEL, value);
  return value;
}

export async function deleteAgent(organizationId: string, agentId: string): Promise<boolean> {
  const current = await getAgent(organizationId, agentId);
  if (!current) return false;
  return sessionFor(organizationId, async (session) => {
    const result = await session.run(
      `MATCH (n)
       WHERE n.organizationId = $organizationId
         AND ((n:${DEFINITION_LABEL} AND n.id = $agentId) OR (n:${DEPLOYMENT_LABEL} AND n.agentId = $agentId))
       WITH collect(n) AS nodes, count(n) AS removed
       FOREACH (node IN nodes | DETACH DELETE node)
       RETURN removed AS removed`,
      { organizationId, agentId },
    );
    const removed = result.records[0]?.get('removed');
    return Number(removed?.toString?.() ?? removed ?? 0) > 0;
  });
}

function organizationTokenPart(organizationId: string): string {
  return Buffer.from(organizationId, 'utf8').toString('base64url');
}

export function parseAgentApiKey(apiKey: string): { organizationId: string; deploymentId: string } | null {
  if (apiKey.length > 600) return null;
  const match = /^ag_live_([A-Za-z0-9_-]+)_([0-9a-f-]{36})_([A-Za-z0-9_-]{40,})$/.exec(apiKey);
  if (!match) return null;
  try {
    const organizationId = Buffer.from(match[1], 'base64url').toString('utf8');
    return /^[A-Za-z0-9_-]{1,128}$/.test(organizationId) ? { organizationId, deploymentId: match[2] } : null;
  } catch {
    return null;
  }
}

export async function createAgentDeployment(input: { organizationId: string; agentId: string; name: string; createdBy: string }): Promise<{ deployment: ReturnType<typeof publicDeployment>; apiKey: string }> {
  const agent = await getAgent(input.organizationId, input.agentId);
  if (!agent) throw new Error('Agent not found.');
  if (agent.status !== 'active') throw new Error('Paused agents cannot create deployments.');
  const name = input.name.normalize('NFKC').trim();
  if (!name || name.length > 120) throw new Error('Deployment name must contain between 1 and 120 characters.');
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const apiKey = `ag_live_${organizationTokenPart(input.organizationId)}_${id}_${secret}`;
  const now = new Date().toISOString();
  const deployment: AgentDeployment = {
    id,
    organizationId: input.organizationId,
    agentId: input.agentId,
    name,
    channel: 'openai',
    tokenPrefix: `${apiKey.slice(0, 18)}...${apiKey.slice(-4)}`,
    tokenDigest: digest(apiKey),
    status: 'active',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await putNode(input.organizationId, DEPLOYMENT_LABEL, deployment);
  return { deployment: publicDeployment(deployment), apiKey };
}

export async function revokeAgentDeployment(organizationId: string, deploymentId: string, agentId?: string): Promise<boolean> {
  return sessionFor(organizationId, async (session) => {
    const result = await session.run(`MATCH (n:${DEPLOYMENT_LABEL} {id: $id, organizationId: $organizationId}) RETURN n.json AS json LIMIT 1`, { id: deploymentId, organizationId });
    if (!result.records[0]) return false;
    const current = recordJson<AgentDeployment>(result.records[0]);
    if (agentId && current.agentId !== agentId) return false;
    await putNode(organizationId, DEPLOYMENT_LABEL, { ...current, status: 'revoked', updatedAt: new Date().toISOString() });
    return true;
  });
}

export async function authorizeAgentApiKey(apiKey: string): Promise<{ agent: AgentDefinition; deployment: AgentDeployment } | null> {
  const parsed = parseAgentApiKey(apiKey);
  if (!parsed) return null;
  const { organizationId, deploymentId } = parsed;
  const deployment = await sessionFor(organizationId, async (session) => {
    const result = await session.run(`MATCH (n:${DEPLOYMENT_LABEL} {id: $id, organizationId: $organizationId}) RETURN n.json AS json LIMIT 1`, { id: deploymentId, organizationId });
    return result.records[0] ? recordJson<AgentDeployment>(result.records[0]) : null;
  });
  if (!deployment || deployment.status !== 'active') return null;
  const expected = Buffer.from(deployment.tokenDigest, 'hex');
  const actual = Buffer.from(digest(apiKey), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const agent = await getAgent(organizationId, deployment.agentId);
  if (!agent || agent.status !== 'active') return null;
  const updated = { ...deployment, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await putNode(organizationId, DEPLOYMENT_LABEL, updated);
  return { agent, deployment: updated };
}
