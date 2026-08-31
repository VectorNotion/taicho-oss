import { z } from 'zod';
import { knowledgeUses } from '@content-automation/knowledge';

export const agentStatusSchema = z.enum(['active', 'paused']);
export const agentChannelSchema = z.enum([
  'slack',
  'microsoft-teams',
  'discord',
  'web-chat',
  'api-sdk',
  'custom-apps',
  'n8n',
  'make',
]);

export type AgentChannel = z.infer<typeof agentChannelSchema>;

export const agentChannelOptions: ReadonlyArray<{
  key: AgentChannel;
  name: string;
  description: string;
}> = [
  { key: 'slack', name: 'Slack', description: 'Team assistant' },
  { key: 'microsoft-teams', name: 'Microsoft Teams', description: 'Internal copilot' },
  { key: 'discord', name: 'Discord', description: 'Community agent' },
  { key: 'web-chat', name: 'Web chat', description: 'Customer guide' },
  { key: 'api-sdk', name: 'API & SDK', description: 'Any compatible client' },
  { key: 'custom-apps', name: 'Custom apps', description: 'Webhooks and workflows' },
  { key: 'n8n', name: 'n8n', description: 'Visual automations' },
  { key: 'make', name: 'Make.com', description: 'No-code scenarios' },
];

const agentConfigurationFields = {
  name: z.string().trim().min(2).max(120).describe('Display name for the external agent'),
  description: z.string().trim().min(2).max(500).describe('Short explanation of the agent mission'),
  instructions: z.string().trim().min(10).max(20_000).describe('System instructions that govern the agent runtime'),
  channels: z.array(agentChannelSchema).min(1).max(agentChannelOptions.length)
    .describe('External destinations this agent is intended to serve'),
  canWriteNotes: z.boolean().describe('Whether the agent may create attributable durable notes'),
};

const agentKnowledgePolicyFields = {
  projectionKeys: z.array(z.string().trim().min(3).max(160)).min(1).max(20).describe('Knowledge projections the agent may read'),
  allowedUses: z.array(z.enum(knowledgeUses)).min(1).max(6).describe('Purposes for which graph evidence may be used'),
  maxSensitivity: z.enum(['public', 'workspace', 'restricted']).describe('Highest graph sensitivity visible to the agent'),
  maxHops: z.number().int().min(1).max(3).describe('Maximum graph traversal depth'),
  maxResults: z.number().int().min(1).max(100).describe('Maximum graph results returned per operation'),
};

export const agentCreateInputSchema = z.object({
  ...agentConfigurationFields,
  canWriteNotes: agentConfigurationFields.canWriteNotes.default(true)
    .describe('Whether the agent may create attributable durable notes'),
}).strict();

export const agentDefinitionInputSchema = z.object({
  ...agentConfigurationFields,
  ...agentKnowledgePolicyFields,
  maxSensitivity: agentKnowledgePolicyFields.maxSensitivity.default('restricted').describe('Highest graph sensitivity visible to the agent'),
  maxHops: agentKnowledgePolicyFields.maxHops.default(3).describe('Maximum graph traversal depth'),
  maxResults: agentKnowledgePolicyFields.maxResults.default(50).describe('Maximum graph results returned per operation'),
  canWriteNotes: agentConfigurationFields.canWriteNotes.default(true).describe('Whether the agent may create attributable durable notes'),
});

export const agentDefinitionUpdateSchema = z.object({
  name: agentConfigurationFields.name.optional().describe('Display name for the external agent'),
  description: agentConfigurationFields.description.optional().describe('Short explanation of the agent mission'),
  instructions: agentConfigurationFields.instructions.optional().describe('System instructions that govern the agent runtime'),
  channels: agentConfigurationFields.channels.optional().describe('External destinations this agent is intended to serve'),
  canWriteNotes: agentConfigurationFields.canWriteNotes.optional().describe('Whether the agent may create attributable durable notes'),
  status: agentStatusSchema.optional().describe('Operational status for the agent'),
  expectedUpdatedAt: z.string().datetime().optional().describe('Last observed update timestamp for optimistic concurrency'),
}).strict();

export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;
export type AgentDefinitionInput = z.infer<typeof agentDefinitionInputSchema>;

export interface AgentDefinition extends AgentDefinitionInput {
  id: string;
  organizationId: string;
  slug: string;
  version: number;
  status: z.infer<typeof agentStatusSchema>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDeployment {
  id: string;
  organizationId: string;
  agentId: string;
  name: string;
  channel: 'openai';
  tokenPrefix: string;
  tokenDigest: string;
  status: 'active' | 'revoked';
  lastUsedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentDeploymentView = Omit<AgentDeployment, 'tokenDigest'>;

export interface AgentWithDeployments {
  agent: AgentDefinition;
  deployments: AgentDeploymentView[];
}

export type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const agentPlaygroundMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(10_000),
}).strict();

export const agentPlaygroundInputSchema = z.object({
  agentPlayground: z.object({ agentId: z.string().uuid() }).strict(),
  messages: z.array(agentPlaygroundMessageSchema).min(1).max(24),
}).strict().refine(
  ({ messages }) => messages.at(-1)?.role === 'user',
  { message: 'The last playground message must come from the user.', path: ['messages'] },
);

export type AgentPlaygroundInput = z.infer<typeof agentPlaygroundInputSchema>;

export const openAiChatCompletionSchema = z.object({
  model: z.string().trim().min(1).max(300),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(100_000),
  })).min(1).max(100),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(32_768).optional(),
  user: z.string().trim().max(240).optional(),
});

export type OpenAiChatCompletionInput = z.input<typeof openAiChatCompletionSchema>;

export function publicDeployment(deployment: AgentDeployment): AgentDeploymentView {
  const { tokenDigest: _tokenDigest, ...view } = deployment;
  return view;
}
