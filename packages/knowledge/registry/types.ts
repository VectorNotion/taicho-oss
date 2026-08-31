export const knowledgeUses = [
  'research',
  'qualification',
  'outreach',
  'content',
  'citation',
  'internal',
] as const;

export type KnowledgeUse = typeof knowledgeUses[number];

export const baseEntityKinds = [
  'person',
  'organization',
  'concept',
  'place',
  'event',
  'thing',
] as const;

export type BaseEntityKind = typeof baseEntityKinds[number];

export interface EntityTypeDefinition {
  key: string;
  name: string;
  description: string;
  baseKind: BaseEntityKind;
  extends?: string;
  equivalentTo?: string;
  sensitivity?: 'public' | 'workspace' | 'restricted';
  allowedUses?: KnowledgeUse[];
}

export interface PredicateDefinition {
  key: string;
  name: string;
  description: string;
  subjectTypes: string[];
  objectTypes: string[];
  objectKind: 'entity' | 'literal' | 'either';
  /** Only single-valued predicates can infer a contradiction from competing objects. */
  cardinality?: 'one' | 'many';
  inverseOf?: string;
  symmetric?: boolean;
  sensitivity?: 'public' | 'workspace' | 'restricted';
  allowedUses?: KnowledgeUse[];
}

export interface ExtractionProfileDefinition {
  key: string;
  name: string;
  description: string;
  entityTypes: string[];
  predicates: string[];
  instructions: string[];
}

export interface ReadProjectionDefinition {
  key: string;
  name: string;
  description: string;
  entityTypes: string[];
  predicates: string[];
  artifactKinds?: string[];
  assessmentKinds?: string[];
  allowedUses: KnowledgeUse[];
  defaultLimit: number;
}

export interface AliasDefinition {
  from: string;
  to: string;
  kind: 'type' | 'predicate' | 'profile' | 'projection';
}

export interface RegistryMigrationDefinition {
  fromVersion: number;
  toVersion: number;
  replacedBy: Record<string, string>;
}

export interface KnowledgeModuleManifest {
  moduleKey: string;
  version: number;
  knowledge: 'contributes' | 'none';
  entityTypes: EntityTypeDefinition[];
  predicates: PredicateDefinition[];
  extractionProfiles: ExtractionProfileDefinition[];
  readProjections: ReadProjectionDefinition[];
  capabilityIds: string[];
  aliases: AliasDefinition[];
  migrations: RegistryMigrationDefinition[];
}

export interface CompiledKnowledgeRegistry {
  hash: string;
  manifests: readonly KnowledgeModuleManifest[];
  entityTypes: ReadonlyMap<string, EntityTypeDefinition>;
  predicates: ReadonlyMap<string, PredicateDefinition>;
  extractionProfiles: ReadonlyMap<string, ExtractionProfileDefinition>;
  readProjections: ReadonlyMap<string, ReadProjectionDefinition>;
  aliases: ReadonlyMap<string, string>;
  capabilityIds: readonly string[];
}
