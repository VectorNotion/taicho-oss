import { createHash } from 'node:crypto';
import { knowledgeModuleManifestSchema } from './schema';
import type {
  AliasDefinition,
  CompiledKnowledgeRegistry,
  EntityTypeDefinition,
  ExtractionProfileDefinition,
  KnowledgeModuleManifest,
  PredicateDefinition,
  ReadProjectionDefinition,
} from './types';

function insertUnique<T extends { key: string }>(map: Map<string, T>, value: T, kind: string) {
  const normalized = value.key.toLowerCase();
  if (map.has(normalized)) throw new Error(`Knowledge registry ${kind} collision: ${value.key}`);
  map.set(normalized, Object.freeze({ ...value }));
}

function requireReference(map: ReadonlyMap<string, unknown>, key: string, owner: string, kind: string) {
  if (!map.has(key.toLowerCase())) {
    throw new Error(`Knowledge registry ${owner} references unknown ${kind}: ${key}`);
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]));
  }
  return value;
}

function immutableMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const map = new Map(source);
  return Object.freeze({
    get size() { return map.size; },
    get: map.get.bind(map),
    has: map.has.bind(map),
    entries: map.entries.bind(map),
    keys: map.keys.bind(map),
    values: map.values.bind(map),
    forEach: map.forEach.bind(map),
    [Symbol.iterator]: map[Symbol.iterator].bind(map),
  });
}

function validateOwnership(manifest: KnowledgeModuleManifest, key: string, kind: string) {
  if (!key.startsWith(`${manifest.moduleKey}.`)) {
    throw new Error(`${manifest.moduleKey} ${kind} must use its own namespace: ${key}`);
  }
}

function aliasMap(
  aliases: AliasDefinition[],
  types: ReadonlyMap<string, EntityTypeDefinition>,
  predicates: ReadonlyMap<string, PredicateDefinition>,
  profiles: ReadonlyMap<string, ExtractionProfileDefinition>,
  projections: ReadonlyMap<string, ReadProjectionDefinition>,
) {
  const result = new Map<string, string>();
  const targets = { type: types, predicate: predicates, profile: profiles, projection: projections };
  for (const alias of aliases) {
    const from = `${alias.kind}:${alias.from.toLowerCase()}`;
    if (result.has(from)) throw new Error(`Knowledge registry alias collision: ${alias.from}`);
    if (targets[alias.kind].has(alias.from.toLowerCase())) throw new Error(`Knowledge registry alias collides with an active ${alias.kind}: ${alias.from}`);
    requireReference(targets[alias.kind], alias.to, alias.from, `${alias.kind} target`);
    result.set(from, alias.to.toLowerCase());
  }
  return result;
}

function validateTypeCycles(types: ReadonlyMap<string, EntityTypeDefinition>) {
  for (const type of types.values()) {
    const seen = new Set<string>();
    let cursor: EntityTypeDefinition | undefined = type;
    while (cursor) {
      if (seen.has(cursor.key)) throw new Error(`Knowledge registry type inheritance cycle: ${type.key}`);
      seen.add(cursor.key);
      const next: string | undefined = cursor.extends ?? cursor.equivalentTo;
      cursor = next ? types.get(next.toLowerCase()) : undefined;
    }
  }
}

export function compileKnowledgeRegistry(
  input: readonly KnowledgeModuleManifest[],
  options: { capabilityIds?: ReadonlySet<string> } = {},
): CompiledKnowledgeRegistry {
  const manifests = input.map((manifest) => knowledgeModuleManifestSchema.parse(manifest) as KnowledgeModuleManifest)
    .sort((left, right) => left.moduleKey.localeCompare(right.moduleKey));
  const modules = new Set<string>();
  const types = new Map<string, EntityTypeDefinition>();
  const predicates = new Map<string, PredicateDefinition>();
  const profiles = new Map<string, ExtractionProfileDefinition>();
  const projections = new Map<string, ReadProjectionDefinition>();
  const allAliases: AliasDefinition[] = [];
  const capabilityIds = new Set<string>();

  for (const manifest of manifests) {
    if (modules.has(manifest.moduleKey)) throw new Error(`Duplicate knowledge module: ${manifest.moduleKey}`);
    modules.add(manifest.moduleKey);
    for (const value of manifest.entityTypes) {
      validateOwnership(manifest, value.key, 'type');
      insertUnique(types, value, 'type');
    }
    for (const value of manifest.predicates) {
      validateOwnership(manifest, value.key, 'predicate');
      insertUnique(predicates, value, 'predicate');
    }
    for (const value of manifest.extractionProfiles) {
      validateOwnership(manifest, value.key, 'profile');
      insertUnique(profiles, value, 'profile');
    }
    for (const value of manifest.readProjections) {
      validateOwnership(manifest, value.key, 'projection');
      insertUnique(projections, value, 'projection');
    }
    for (const id of manifest.capabilityIds) {
      if (options.capabilityIds && !options.capabilityIds.has(id)) {
        throw new Error(`Knowledge module ${manifest.moduleKey} references unknown capability: ${id}`);
      }
      capabilityIds.add(id);
    }
    for (const alias of manifest.aliases) validateOwnership(manifest, alias.from, 'alias source');
    const migrationPairs = new Set<string>();
    for (const migration of manifest.migrations) {
      if (migration.fromVersion >= migration.toVersion || migration.toVersion > manifest.version) {
        throw new Error(`Knowledge module ${manifest.moduleKey} has an invalid migration ${migration.fromVersion}->${migration.toVersion}.`);
      }
      const pair = `${migration.fromVersion}->${migration.toVersion}`;
      if (migrationPairs.has(pair)) throw new Error(`Knowledge module ${manifest.moduleKey} has a duplicate migration ${pair}.`);
      migrationPairs.add(pair);
      for (const from of Object.keys(migration.replacedBy)) {
        if (!from.startsWith(`${manifest.moduleKey}.`)) throw new Error(`${manifest.moduleKey} migration source must use its own namespace: ${from}`);
      }
    }
    allAliases.push(...manifest.aliases);
  }

  for (const value of types.values()) {
    if (value.extends) requireReference(types, value.extends, value.key, 'parent type');
    if (value.equivalentTo) requireReference(types, value.equivalentTo, value.key, 'equivalent type');
  }
  validateTypeCycles(types);
  for (const value of predicates.values()) {
    value.subjectTypes.forEach((key) => requireReference(types, key, value.key, 'subject type'));
    value.objectTypes.forEach((key) => requireReference(types, key, value.key, 'object type'));
    if (value.inverseOf) requireReference(predicates, value.inverseOf, value.key, 'inverse predicate');
  }
  for (const value of profiles.values()) {
    value.entityTypes.forEach((key) => requireReference(types, key, value.key, 'entity type'));
    value.predicates.forEach((key) => requireReference(predicates, key, value.key, 'predicate'));
  }
  for (const value of projections.values()) {
    value.entityTypes.forEach((key) => requireReference(types, key, value.key, 'entity type'));
    value.predicates.forEach((key) => requireReference(predicates, key, value.key, 'predicate'));
  }
  for (const manifest of manifests) {
    for (const migration of manifest.migrations) {
      for (const target of Object.values(migration.replacedBy)) {
        const normalized = target.toLowerCase();
        if (!types.has(normalized) && !predicates.has(normalized) && !profiles.has(normalized) && !projections.has(normalized)) {
          throw new Error(`Knowledge module ${manifest.moduleKey} migration references unknown replacement: ${target}`);
        }
      }
    }
  }
  const aliases = aliasMap(allAliases, types, predicates, profiles, projections);
  const canonical = stable(manifests);
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return Object.freeze({
    hash,
    manifests: Object.freeze(manifests),
    entityTypes: immutableMap(types),
    predicates: immutableMap(predicates),
    extractionProfiles: immutableMap(profiles),
    readProjections: immutableMap(projections),
    aliases: immutableMap(aliases),
    capabilityIds: Object.freeze([...capabilityIds].sort()),
  });
}
