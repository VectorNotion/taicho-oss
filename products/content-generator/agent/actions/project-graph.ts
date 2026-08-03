/**
 * Project-graph orchestrator (Mastra migration of the `build_project_graph`
 * action).
 *
 * Flow (spec §2): guard on `Project.processed` → fetch the project → extract
 * 8-20 canonical entities (8 types) with a Mastra agent + structured output
 * (temp 0.3) → store each entity (dedup + typed project→entity edge) → mark the
 * project processed with the entity count.
 *
 * Agents are never on the hot path: this runs offline via the job runner.
 * Dependencies are injectable (`deps`) so the orchestration can be unit-tested
 * without touching Neo4j or the model API.
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';
import { getSettings as getSettingsDefault } from '@content-automation/platform/settings/repository';
import type { Settings } from '@content-automation/platform/settings/types';
import { streamingStructuredGenerate, type StreamEmit } from '@content-automation/platform/agents/streaming';
import {
  getProjectById as getProjectByIdDefault,
  getProjectProcessingState as getProjectProcessingStateDefault,
  storeProjectEntity as storeProjectEntityDefault,
  markProjectProcessed as markProjectProcessedDefault,
} from '../../data/project-repository';


/**
 * The eight entity types the extractor may emit, each mapping to a typed
 * project→entity relationship in `project-repository.storeProjectEntity`.
 */
export const ENTITY_TYPES = [
  'Framework',
  'Database',
  'Cloud',
  'Language',
  'AIComponent',
  'Feature',
  'Integration',
  'BusinessValue',
] as const;

/**
 * Structured-output schema for entity extraction (spec §2).
 */
export const projectEntitiesSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(ENTITY_TYPES),
    })
  ),
});

export type ProjectEntities = z.infer<typeof projectEntitiesSchema>;
export type ExtractedEntity = ProjectEntities['entities'][number];

/** Minimal project shape the extractor prompt needs. */
export interface ProjectFacts {
  title: string;
  description: string;
}

export interface BuildProjectGraphPayload {
  projectId: string;
}

export interface BuildProjectGraphDeps {
  getProjectById: (id: string) => Promise<{ title: string; description: string } | null>;
  getProjectProcessingState: (
    id: string
  ) => Promise<{ processed: boolean; entityCount: number } | null>;
  storeProjectEntity: (
    projectId: string,
    entity: { name: string; type: string }
  ) => Promise<void>;
  markProjectProcessed: (projectId: string, entityCount: number) => Promise<void>;
  getSettings: () => Promise<Settings>;
  extractEntities: (project: ProjectFacts, settings: Settings) => Promise<ProjectEntities>;
}

export interface BuildProjectGraphResult {
  status: 'success' | 'skipped';
  projectId: string;
  entityCount: number;
  entities?: ExtractedEntity[];
  reason?: string;
}

/**
 * Build the entity-extraction system prompt (spec §2): mission/identity plus the
 * eight canonical entity types and extraction rules.
 */
export function buildExtractionInstructions(settings: Settings): string {
  return `You are a software-architecture analyst extracting the technical and
business entities from a project description.

## Your context
- Mission: ${settings.mission}
- Identity: ${settings.identity}
- Voice: ${settings.voice}

## Task
Extract 8-20 entities from the project below. Each entity has a canonical name
and exactly one of these eight types:
- Framework: application frameworks / libraries (e.g. Next.js, FastAPI)
- Database: data stores (e.g. Postgres, Neo4j)
- Cloud: cloud platforms / hosting (e.g. AWS, Vercel)
- Language: programming languages (e.g. TypeScript, Python)
- AIComponent: AI/ML capabilities (e.g. RAG pipeline, embeddings)
- Feature: user-facing product features
- Integration: third-party services integrated with (e.g. Stripe, Slack)
- BusinessValue: business outcomes achieved (e.g. reduced churn, automation)

## Rules
- Use canonical, widely-recognised names (not marketing phrases).
- Only include entities that are explicitly stated or strongly implied.
- Do not invent technologies that are not supported by the description.`;
}

function buildExtractionPrompt(project: ProjectFacts): string {
  return `Project: ${project.title}\n\nDescription: ${project.description}`;
}

/**
 * Default extractor: a Mastra agent with structured output (temp 0.3, spec §2).
 * The agent is created per call so it always reflects the current settings.
 */
async function defaultExtractEntities(
  project: ProjectFacts,
  settings: Settings
): Promise<ProjectEntities> {
  const agent = registerObservedAgent(new Agent({
    id: 'project-graph-agent',
    name: 'Project Graph Agent',
    instructions: buildExtractionInstructions(settings),
    model: routerModel(),
  }), 'taicho-content-agents');

  const result = await agent.generate(buildExtractionPrompt(project), {
    structuredOutput: { schema: projectEntitiesSchema },
    modelSettings: { temperature: 0.3 },
  });

  return result.object;
}

export function streamingExtractEntities(emit: StreamEmit): BuildProjectGraphDeps['extractEntities'] {
  return (project, settings) => streamingStructuredGenerate(emit)({
    agentId: 'project-graph-agent',
    agentName: 'Project Graph Agent',
    instructions: buildExtractionInstructions(settings),
    prompt: buildExtractionPrompt(project),
    schema: projectEntitiesSchema,
    temperature: 0.3,
  });
}

const defaultDeps: BuildProjectGraphDeps = {
  getProjectById: getProjectByIdDefault,
  getProjectProcessingState: getProjectProcessingStateDefault,
  storeProjectEntity: storeProjectEntityDefault,
  markProjectProcessed: markProjectProcessedDefault,
  getSettings: getSettingsDefault,
  extractEntities: defaultExtractEntities,
};

/**
 * Extract a project's entities into the knowledge graph.
 *
 * @param payload - `{ projectId }`
 * @param deps - optional dependency overrides (for testing / injection)
 */
export async function runBuildProjectGraph(
  payload: BuildProjectGraphPayload,
  deps: Partial<BuildProjectGraphDeps> = {}
): Promise<BuildProjectGraphResult> {
  const d: BuildProjectGraphDeps = { ...defaultDeps, ...deps };
  const { projectId } = payload;

  const state = await d.getProjectProcessingState(projectId);
  if (state === null) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Skip if already processed (spec §2: guard on Project.processed).
  if (state.processed) {
    console.log(`[ProjectGraph] Project ${projectId} already processed; skipping`);
    return {
      status: 'skipped',
      projectId,
      entityCount: state.entityCount,
      reason: 'already processed',
    };
  }

  const project = await d.getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const settings = await d.getSettings();
  const { entities } = await d.extractEntities(
    { title: project.title, description: project.description },
    settings
  );

  for (const entity of entities) {
    await d.storeProjectEntity(projectId, entity);
  }

  await d.markProjectProcessed(projectId, entities.length);

  console.log(
    `[ProjectGraph] Project ${projectId} processed: ${entities.length} entities`
  );

  return {
    status: 'success',
    projectId,
    entityCount: entities.length,
    entities,
  };
}
