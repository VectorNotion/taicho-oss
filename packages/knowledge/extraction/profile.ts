import type { CompiledKnowledgeRegistry } from '../registry/types';
import type { BoundedExtractionSchema } from './types';

export function compileExtractionProfile(registry: CompiledKnowledgeRegistry, profileKeys: readonly string[]): BoundedExtractionSchema {
  if (profileKeys.length === 0) throw new Error('At least one extraction profile is required.');
  const entityKeys = new Set<string>();
  const predicateKeys = new Set<string>();
  const instructions = new Set<string>();
  for (const key of [...new Set(profileKeys)].sort()) {
    const profile = registry.extractionProfiles.get(key);
    if (!profile) throw new Error(`Unknown extraction profile: ${key}`);
    profile.entityTypes.forEach((value) => entityKeys.add(value));
    profile.predicates.forEach((value) => predicateKeys.add(value));
    profile.instructions.forEach((value) => instructions.add(value));
  }
  if (entityKeys.size > 80 || predicateKeys.size > 120) throw new Error('The requested extraction profile union is too broad.');
  return {
    profileKeys: [...new Set(profileKeys)].sort(),
    entityTypes: [...entityKeys].sort().map((key) => {
      const value = registry.entityTypes.get(key);
      if (!value) throw new Error(`Profile references unknown type: ${key}`);
      return { key: value.key, name: value.name, description: value.description, baseKind: value.baseKind };
    }),
    predicates: [...predicateKeys].sort().map((key) => {
      const value = registry.predicates.get(key);
      if (!value) throw new Error(`Profile references unknown predicate: ${key}`);
      return { key: value.key, name: value.name, description: value.description, subjectTypes: value.subjectTypes, objectTypes: value.objectTypes, objectKind: value.objectKind };
    }),
    instructions: [...instructions],
  };
}
