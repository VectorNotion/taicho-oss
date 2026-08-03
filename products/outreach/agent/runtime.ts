import { Mastra } from '@mastra/core/mastra';
import { createLangfuseObservability } from '@content-automation/observability/ai';
import { leadResearchAgent } from './lead-research-agent';
import { outreachAgent } from './mastra-agent';
import { getStorage } from './storage';

const observability = createLangfuseObservability('outreach-agent');

export const outreachMastra = new Mastra({
  agents: { leadResearchAgent, outreachAgent },
  storage: getStorage(),
  ...(observability ? { observability } : {}),
});
