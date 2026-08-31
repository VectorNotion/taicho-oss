/**
 * Project-graph orchestrator (Mastra migration of the `build_project_graph`
 * action).
 *
 * Flow (spec §2): guard on `Project.processed` → fetch the project → extract
 * registered canonical entities with a Mastra agent + structured output
 * (temp 0.3) → reconcile evidence-backed claims → mark the
 * project processed with the entity count.
 *
 * Agents are never on the hot path: this runs offline via the job runner.
 * Dependencies are injectable (`deps`) so the orchestration can be unit-tested
 * without touching Neo4j or the model API.
 */
import { Agent } from '@mastra/core/agent';
import { baseEntityKinds, resolveOrganizationRegistry } from '@content-automation/knowledge';
import { requireGraphOrganizationId } from '@content-automation/platform/data/graph';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { observeWorkflowStep, traceable } from '@content-automation/observability';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';
import { getSettings as getSettingsDefault } from '@content-automation/platform/settings/repository';
import type { Settings } from '@content-automation/platform/settings/types';
import { streamingStructuredGenerate, type StreamEmit } from '@content-automation/platform/agents/streaming';
import {
  getProjectById as getProjectByIdDefault,
  getProjectProcessingState as getProjectProcessingStateDefault,
  markProjectProcessed as markProjectProcessedDefault,
} from '../../data/project-repository';
import { contentKnowledgeManifest } from '../../knowledge-manifest';
import { resolveExtractedTypes, typeIndexFromRegistry, type TypeIndexEntry, type TypedExtractedEntity } from './project-graph-typing';
import { reconcileProjectKnowledge as reconcileProjectKnowledgeDefault } from '../../knowledge-service';


/**
 * Registered roles seed the type index; the profile is a lens, not a gate —
 * the model may propose a type of its own, and unmatched proposals become
 * type candidates for the self-curating ontology.
 */
const projectProfile = contentKnowledgeManifest.extractionProfiles.find(({ key }) => key === 'content.project_extraction');
if (!projectProfile) throw new Error('The Content knowledge manifest is missing content.project_extraction.');
export const PROJECT_ENTITY_TYPES = projectProfile.entityTypes.filter((key) => key !== 'content.project' && !key.startsWith('core.'));

/**
 * Structured-output schema for open extraction: a free type phrase, the
 * generic core kind it falls back to, and a one-line definition (the material
 * type candidates and embedding matches are built from).
 */
export const projectEntitiesSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.string().describe('Registered type key when one fits, otherwise your own short type phrase.'),
      kind: z.enum(baseEntityKinds),
      definition: z.string().describe('One sentence defining this entity as used in the project.'),
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
  reconcileProjectKnowledge: typeof reconcileProjectKnowledgeDefault;
  markProjectProcessed: (projectId: string, entityCount: number) => Promise<void>;
  getSettings: () => Promise<Settings>;
  extractEntities: (project: ProjectFacts, settings: Settings, typeOptions: readonly TypeIndexEntry[]) => Promise<ProjectEntities>;
  resolveTypeIndex: () => Promise<TypeIndexEntry[]>;
  resolveTypes: (entities: ProjectEntities['entities'], index: readonly TypeIndexEntry[]) => Promise<TypedExtractedEntity[]>;
}

export interface BuildProjectGraphResult {
  status: 'success' | 'skipped';
  projectId: string;
  entityCount: number;
  entities?: Array<{ name: string; type: string }>;
  /** Concepts no registered type fit — recorded as ontology type candidates. */
  typeCandidates?: Array<{ name: string; proposedTypeName: string }>;
  reason?: string;
}

/**
 * Build the entity-extraction system prompt (spec §2): mission/identity plus the
 * registered entity roles and extraction rules.
 */
export function buildExtractionInstructions(settings: Settings, typeOptions: readonly TypeIndexEntry[]): string {
  return `You are a software-architecture analyst extracting the technical and
business entities from a project description.

## Your context
- Mission: ${settings.mission}
- Identity: ${settings.identity}
- Voice: ${settings.voice}

## Task
Extract every useful entity from the project below. For each entity provide:
- name: the canonical, widely-recognised name (not a marketing phrase)
- type: the registered type key below when one genuinely fits; otherwise
  propose your own short lowercase type phrase (e.g. "technique", "capability")
- kind: the generic kind of thing it is (${baseEntityKinds.join(' | ')})
- definition: one sentence defining the entity as used in this project

Registered types:
${typeOptions.map((entry) => `- ${entry.key}: ${entry.description}`).join('\n')}

## Rules
- Only include entities that are explicitly stated or strongly implied.
- Do not invent technologies that are not supported by the description.
- Never force an entity into a registered type that does not fit — propose a
  better type phrase instead.`;
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
  settings: Settings,
  typeOptions: readonly TypeIndexEntry[]
): Promise<ProjectEntities> {
  const agent = registerObservedAgent(new Agent({
    id: 'project-graph-agent',
    name: 'Project Graph Agent',
    instructions: buildExtractionInstructions(settings, typeOptions),
    model: routerModel(),
  }), 'taicho-content-agents');

  const instructions = buildExtractionInstructions(settings, typeOptions);
  const prompt = buildExtractionPrompt(project);
  return traceable(
    async () => {
      const result = await agent.generate(prompt, {
        structuredOutput: { schema: projectEntitiesSchema },
        modelSettings: { temperature: 0.3 },
      });
      return result.object;
    },
    {
      name: 'content.project_graph.extract',
      kind: 'generation',
      processInputs: () => ({ instructions, prompt, temperature: 0.3 }),
      processOutputs: (output) => ({ entityCount: output.entities.length, entities: output.entities }),
    },
  )();
}

export function streamingExtractEntities(emit: StreamEmit): BuildProjectGraphDeps['extractEntities'] {
  return (project, settings, typeOptions) => streamingStructuredGenerate(emit)({
    agentId: 'project-graph-agent',
    agentName: 'Project Graph Agent',
    instructions: buildExtractionInstructions(settings, typeOptions),
    prompt: buildExtractionPrompt(project),
    schema: projectEntitiesSchema,
    temperature: 0.3,
  });
}

/** Deterministic non-production extractor used by the real browser QA path. */
export function localProjectExtractEntities(emit: StreamEmit): BuildProjectGraphDeps['extractEntities'] {
  return async (project) => {
    const text = `${project.title}\n${project.description}`;
    const catalog: Array<ExtractedEntity & { pattern: RegExp }> = [
      { name: 'Next.js', type: 'content.framework', kind: 'concept', definition: 'The Next.js web framework used by the project.', pattern: /\bnext\.?js\b/i },
      { name: 'React', type: 'content.framework', kind: 'concept', definition: 'The React interface framework used by the project.', pattern: /\breact\b/i },
      { name: 'PostgreSQL', type: 'content.database', kind: 'concept', definition: 'The PostgreSQL relational database used by the project.', pattern: /\bpostgres(?:ql)?\b/i },
      { name: 'FalkorDB', type: 'content.database', kind: 'concept', definition: 'The FalkorDB graph database used by the project.', pattern: /\bfalkordb\b/i },
      { name: 'OpenRouter', type: 'content.integration', kind: 'concept', definition: 'The OpenRouter model integration used by the project.', pattern: /\bopenrouter\b/i },
      { name: 'Signed webhooks', type: 'content.integration', kind: 'concept', definition: 'Signed webhook delivery exposed by the project.', pattern: /\bsigned webhooks?\b/i },
      { name: 'Durable workflow recovery', type: 'content.feature', kind: 'concept', definition: 'Durable workflow recovery provided by the project.', pattern: /\bdurable workflow(?: recovery)?\b/i },
      { name: 'Browser automation', type: 'content.feature', kind: 'concept', definition: 'Browser automation used to verify the project.', pattern: /\bbrowser automation\b/i },
      { name: 'Language model', type: 'content.ai_component', kind: 'concept', definition: 'A language-model component used by the project.', pattern: /\b(?:language model|llm)\b/i },
    ];
    const entities = catalog
      .filter(({ pattern }) => pattern.test(text))
      .map(({ pattern: _pattern, ...entity }) => entity);
    emit({
      type: 'data-reasoning',
      id: 'default',
      data: { text: 'Reading the project description and matching supported technical concepts.' },
    });
    emit({
      type: 'data-partial',
      id: 'default',
      data: { entities: entities.map(({ name, type }) => ({ name, type })) },
    });
    return projectEntitiesSchema.parse({ entities });
  };
}

async function defaultResolveTypeIndex(): Promise<TypeIndexEntry[]> {
  const registry = await resolveOrganizationRegistry(requireGraphOrganizationId());
  return typeIndexFromRegistry(registry, PROJECT_ENTITY_TYPES);
}

const defaultDeps: BuildProjectGraphDeps = {
  getProjectById: getProjectByIdDefault,
  getProjectProcessingState: getProjectProcessingStateDefault,
  reconcileProjectKnowledge: reconcileProjectKnowledgeDefault,
  markProjectProcessed: markProjectProcessedDefault,
  getSettings: getSettingsDefault,
  extractEntities: defaultExtractEntities,
  resolveTypeIndex: defaultResolveTypeIndex,
  resolveTypes: (entities, index) => resolveExtractedTypes(entities, index),
};

/**
 * Extract a project's entities into the knowledge graph.
 *
 * @param payload - `{ projectId }`
 * @param deps - optional dependency overrides (for testing / injection)
 */
async function runBuildProjectGraphInternal(
  payload: BuildProjectGraphPayload,
  deps: Partial<BuildProjectGraphDeps> = {}
): Promise<BuildProjectGraphResult> {
  const d: BuildProjectGraphDeps = { ...defaultDeps, ...deps };
  const { projectId } = payload;

  const state = await observeWorkflowStep('content.project_graph.load_state', {
    kind: 'data',
    input: { projectId },
    processOutput: (output) => output ?? { found: false },
  }, () => d.getProjectProcessingState(projectId));
  if (state === null) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const project = await observeWorkflowStep('content.project_graph.load_project', {
    kind: 'data',
    input: { projectId },
    processOutput: (output) => output ? { found: true } : { found: false },
  }, () => d.getProjectById(projectId));
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const settings = await d.getSettings();
  const typeIndex = await observeWorkflowStep('content.project_graph.type_index', {
    kind: 'data',
    input: { projectId },
    processOutput: (output) => ({ typeCount: (output as TypeIndexEntry[]).length }),
  }, () => d.resolveTypeIndex());
  const { entities } = await d.extractEntities(
    { title: project.title, description: project.description },
    settings,
    typeIndex
  );

  const typed = await observeWorkflowStep('content.project_graph.type_resolution', {
    kind: 'data',
    input: { projectId, entityCount: entities.length },
    processOutput: (output) => { const typed = output as TypedExtractedEntity[]; return { typed: typed.length, misses: typed.filter((entity) => entity.miss).length }; },
  }, () => d.resolveTypes(entities, typeIndex));

  await observeWorkflowStep('content.project_graph.persist', {
    kind: 'persistence',
    input: { projectId, entityCount: typed.length },
    processOutput: () => ({ persistedEntityCount: typed.length, markedProcessed: true }),
  }, async () => {
    await d.reconcileProjectKnowledge({ projectId, title: project.title, description: project.description, entities: typed });
    await d.markProjectProcessed(projectId, typed.length);
  });

  const typeCandidates = typed
    .filter((entity) => entity.miss)
    .map((entity) => ({ name: entity.name, proposedTypeName: entity.miss!.proposedTypeName }));
  console.log(
    `[ProjectGraph] Project ${projectId} processed: ${typed.length} entities, ${typeCandidates.length} type candidates`
  );

  return {
    status: 'success',
    projectId,
    entityCount: typed.length,
    entities: typed.map(({ name, typeKey }) => ({ name, type: typeKey })),
    typeCandidates,
  };
}

export const runBuildProjectGraph = traceable(runBuildProjectGraphInternal, {
  name: 'content.project_graph.build',
  kind: 'workflow',
  processInputs: ([payload]) => payload,
});
