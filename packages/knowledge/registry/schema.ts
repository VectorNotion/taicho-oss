import { z } from 'zod';
import { baseEntityKinds, knowledgeUses, type KnowledgeModuleManifest } from './types';

const key = z.string().trim().min(3).max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/, 'Use a stable lowercase namespaced key.');
const text = z.string().trim().min(1).max(2_000);
const use = z.enum(knowledgeUses);
const sensitivity = z.enum(['public', 'workspace', 'restricted']);

export const entityTypeDefinitionSchema = z.object({
  key,
  name: text.max(160),
  description: text,
  baseKind: z.enum(baseEntityKinds),
  extends: key.optional(),
  equivalentTo: key.optional(),
  sensitivity: sensitivity.optional(),
  allowedUses: z.array(use).min(1).optional(),
});

export const predicateDefinitionSchema = z.object({
  key,
  name: text.max(160),
  description: text,
  subjectTypes: z.array(key).min(1),
  objectTypes: z.array(key),
  objectKind: z.enum(['entity', 'literal', 'either']),
  cardinality: z.enum(['one', 'many']).default('many'),
  inverseOf: key.optional(),
  symmetric: z.boolean().optional(),
  sensitivity: sensitivity.optional(),
  allowedUses: z.array(use).min(1).optional(),
}).superRefine((value, context) => {
  if (value.objectKind === 'entity' && value.objectTypes.length === 0) {
    context.addIssue({ code: 'custom', message: 'Entity predicates require objectTypes.', path: ['objectTypes'] });
  }
});

export const extractionProfileDefinitionSchema = z.object({
  key,
  name: text.max(160),
  description: text,
  entityTypes: z.array(key),
  predicates: z.array(key),
  instructions: z.array(text).min(1),
});

export const readProjectionDefinitionSchema = z.object({
  key,
  name: text.max(160),
  description: text,
  entityTypes: z.array(key),
  predicates: z.array(key),
  artifactKinds: z.array(key).default([]),
  assessmentKinds: z.array(key).default([]),
  allowedUses: z.array(use).min(1),
  defaultLimit: z.number().int().min(1).max(500).default(50),
});

export const knowledgeModuleManifestSchema = z.object({
  moduleKey: z.string().trim().min(2).max(80).regex(/^[a-z][a-z0-9]*$/),
  version: z.number().int().positive(),
  knowledge: z.enum(['contributes', 'none']),
  entityTypes: z.array(entityTypeDefinitionSchema).default([]),
  predicates: z.array(predicateDefinitionSchema).default([]),
  extractionProfiles: z.array(extractionProfileDefinitionSchema).default([]),
  readProjections: z.array(readProjectionDefinitionSchema).default([]),
  capabilityIds: z.array(key).default([]),
  aliases: z.array(z.object({ from: key, to: key, kind: z.enum(['type', 'predicate', 'profile', 'projection']) })).default([]),
  migrations: z.array(z.object({
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    replacedBy: z.record(key, key),
  })).default([]),
}).superRefine((value, context) => {
  const definitions = value.entityTypes.length + value.predicates.length
    + value.extractionProfiles.length + value.readProjections.length;
  if (value.knowledge === 'none' && (definitions > 0 || value.aliases.length > 0 || value.migrations.length > 0)) {
    context.addIssue({ code: 'custom', message: "A knowledge:'none' manifest cannot contribute definitions." });
  }
});

export function defineKnowledgeManifest(input: KnowledgeModuleManifest): KnowledgeModuleManifest {
  return knowledgeModuleManifestSchema.parse(input) as KnowledgeModuleManifest;
}
