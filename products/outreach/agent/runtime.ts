import { Mastra } from '@mastra/core/mastra';
import { createLangfuseObservability } from '@content-automation/observability/ai';
import { prospectResearchAgent } from './prospect-research-agent';
import { outreachAgent } from './mastra-agent';
import { getStorage } from './storage';

const observability = createLangfuseObservability('outreach-agent');

export const outreachMastra = new Mastra({
  agents: { prospectResearchAgent, outreachAgent },
  storage: getStorage(),
  ...(observability ? { observability } : {}),
});
