import type {
  ContextBundle,
  KnowledgeNote,
  KnowledgeNoteAttribution,
  KnowledgeNoteKind,
  KnowledgeSearchResult,
  KnowledgeSensitivity,
  KnowledgeTraversalDirection,
  KnowledgeTraversalResult,
} from './domain';
import {
  createKnowledgeNote,
  getKnowledgeNote,
  queryKnowledgeNotes,
  retractKnowledgeNote,
  reviseKnowledgeNote,
} from './notes';
import { entityTypesAreAssignable } from './repository';
import type { KnowledgeUse } from './registry/types';
import { KnowledgeService } from './service';

const sensitivityRank: Record<KnowledgeSensitivity, number> = { public: 0, workspace: 1, restricted: 2 };

export const AGENT_KNOWLEDGE_PLAYBOOK = {
  version: 'agent-knowledge.v1',
  principles: [
    'Use canonical projections and policy-filtered claims; never query the backing graph directly.',
    'Search broadly, then use bounded traversal and explain before relying on an important claim.',
    'Write durable notes only when they will help a later agent or human; attach explicit canonical subjects.',
    'Separate observation, hypothesis, preference, summary, and decision instead of presenting inference as fact.',
    'Cite the claims a note is based on, preserve confidence and expiry, and retract rather than erase.',
    'Treat every note as shared workspace knowledge subject to provenance, sensitivity, and allowed-use controls.',
  ],
} as const;

export interface AgentKnowledgePolicy {
  projectionKeys: readonly string[];
  allowedUses: readonly KnowledgeUse[];
  maxSensitivity: KnowledgeSensitivity;
  maxHops?: number;
  maxResults?: number;
  canWriteNotes?: boolean;
  canManageAllNotes?: boolean;
  writableEntityTypes?: readonly string[];
  writableNoteKinds?: readonly KnowledgeNoteKind[];
}

export interface AgentKnowledgeScope {
  projectionKey: string;
  use: KnowledgeUse;
}

export class KnowledgeAgentAdapter {
  readonly policy: Required<Pick<AgentKnowledgePolicy, 'maxHops' | 'maxResults' | 'canWriteNotes' | 'canManageAllNotes'>> & AgentKnowledgePolicy;

  constructor(
    readonly service: KnowledgeService,
    policy: AgentKnowledgePolicy,
    readonly attribution: KnowledgeNoteAttribution,
  ) {
    if (policy.projectionKeys.length === 0) throw new Error('Agent knowledge policy requires at least one projection.');
    if (policy.allowedUses.length === 0) throw new Error('Agent knowledge policy requires at least one allowed use.');
    this.policy = {
      ...policy,
      projectionKeys: [...new Set(policy.projectionKeys)],
      allowedUses: [...new Set(policy.allowedUses)],
      maxHops: Math.min(Math.max(policy.maxHops ?? 2, 1), 3),
      maxResults: Math.min(Math.max(policy.maxResults ?? 50, 1), 100),
      canWriteNotes: policy.canWriteNotes ?? false,
      canManageAllNotes: policy.canManageAllNotes ?? false,
    };
  }

  playbook() {
    return AGENT_KNOWLEDGE_PLAYBOOK;
  }

  async search(input: AgentKnowledgeScope & { query: string; limit?: number; minimumConfidence?: number }): Promise<KnowledgeSearchResult> {
    const policy = this.scope(input);
    return this.service.search({
      projectionKey: input.projectionKey,
      query: input.query,
      policy,
      limit: this.limit(input.limit),
      minimumConfidence: input.minimumConfidence,
    });
  }

  async context(input: AgentKnowledgeScope & { subjectEntityIds?: string[]; limit?: number; minimumConfidence?: number; includeStale?: boolean }): Promise<ContextBundle> {
    const policy = { ...this.scope(input), includeStale: input.includeStale };
    await this.requireVisibleSubjects(input.subjectEntityIds ?? [], input.projectionKey);
    return this.service.context({
      projectionKey: input.projectionKey,
      subjectEntityIds: input.subjectEntityIds,
      policy,
      limit: this.limit(input.limit),
      minimumConfidence: input.minimumConfidence,
    });
  }

  async traverse(input: AgentKnowledgeScope & {
    startEntityIds: string[];
    direction?: KnowledgeTraversalDirection;
    predicateKeys?: string[];
    maxHops?: number;
    maxPaths?: number;
    minimumConfidence?: number;
    includeLiterals?: boolean;
  }): Promise<KnowledgeTraversalResult> {
    const policy = this.scope(input);
    await this.requireVisibleSubjects(input.startEntityIds, input.projectionKey);
    const maxHops = input.maxHops ?? this.policy.maxHops;
    if (maxHops > this.policy.maxHops) throw new Error(`Agent knowledge policy allows at most ${this.policy.maxHops} hops.`);
    return this.service.traverse({
      projectionKey: input.projectionKey,
      startEntityIds: input.startEntityIds,
      policy,
      direction: input.direction,
      predicateKeys: input.predicateKeys,
      maxHops,
      maxPaths: this.limit(input.maxPaths),
      minimumConfidence: input.minimumConfidence,
      includeLiterals: input.includeLiterals,
    });
  }

  async explain(input: AgentKnowledgeScope & { id: string }) {
    const policy = this.scope(input);
    const explanation = await this.service.explain(input.id, policy);
    if (!explanation) return null;
    const projection = this.service.compiledRegistry.readProjections.get(input.projectionKey)!;
    if (explanation.claims.some((claim) => !projection.predicates.includes(claim.predicateKey))) return null;
    for (const claim of explanation.claims) await this.requireVisibleClaimEntities(claim, input.projectionKey);
    return explanation;
  }

  async coverage(input: AgentKnowledgeScope & { subjectEntityIds?: string[]; limit?: number; minimumConfidence?: number; minimumClaims?: number; minimumAverageConfidence?: number }) {
    const policy = this.scope(input);
    await this.requireVisibleSubjects(input.subjectEntityIds ?? [], input.projectionKey);
    return this.service.coverage({
      projectionKey: input.projectionKey,
      subjectEntityIds: input.subjectEntityIds,
      policy,
      limit: this.limit(input.limit),
      minimumConfidence: input.minimumConfidence,
    }, { minimumClaims: input.minimumClaims, minimumAverageConfidence: input.minimumAverageConfidence });
  }

  async queryNotes(input: AgentKnowledgeScope & { subjectEntityIds?: string[]; kinds?: KnowledgeNoteKind[]; statuses?: Array<'active' | 'retracted'>; limit?: number }): Promise<KnowledgeNote[]> {
    const policy = this.scope(input);
    await this.requireVisibleSubjects(input.subjectEntityIds ?? [], input.projectionKey);
    const notes = await queryKnowledgeNotes(this.service.repository, {
      policy,
      subjectEntityIds: input.subjectEntityIds,
      kinds: input.kinds,
      statuses: input.statuses,
      limit: this.limit(input.limit),
    });
    const visible: KnowledgeNote[] = [];
    for (const note of notes) {
      try {
        await this.requireVisibleSubjects(note.subjectEntityIds, input.projectionKey);
        visible.push(note);
      } catch {
        // A note is visible only when all of its subjects are in the selected projection.
      }
    }
    return visible;
  }

  async createNote(input: AgentKnowledgeScope & {
    key: string;
    kind: KnowledgeNoteKind;
    content: string;
    subjectEntityIds: string[];
    basedOnClaimIds?: string[];
    sensitivity?: KnowledgeSensitivity;
    allowedUses?: KnowledgeUse[];
    confidence?: number;
    validUntil?: string;
  }): Promise<KnowledgeNote> {
    this.requireWrite(input);
    await this.requireWritableSubjects(input.subjectEntityIds, input.projectionKey);
    await this.requireBasedOnClaims(input.basedOnClaimIds ?? [], input);
    return createKnowledgeNote(this.service.repository, {
      ...input,
      allowedUses: input.allowedUses ?? [input.use],
      attribution: this.attribution,
    });
  }

  async reviseNote(input: AgentKnowledgeScope & {
    noteId: string;
    expectedRevisionId?: string;
    content: string;
    kind?: KnowledgeNoteKind;
    subjectEntityIds?: string[];
    basedOnClaimIds?: string[];
    sensitivity?: KnowledgeSensitivity;
    allowedUses?: KnowledgeUse[];
    confidence?: number;
    validUntil?: string;
  }): Promise<KnowledgeNote> {
    this.requireWrite(input);
    const current = await this.requireManageableNote(input.noteId, input);
    await this.requireWritableSubjects(input.subjectEntityIds ?? current.subjectEntityIds, input.projectionKey);
    await this.requireBasedOnClaims(input.basedOnClaimIds ?? current.basedOnClaimIds, input);
    return reviseKnowledgeNote(this.service.repository, { ...input, attribution: this.attribution });
  }

  async retractNote(input: AgentKnowledgeScope & { noteId: string; expectedRevisionId?: string; reason?: string }): Promise<KnowledgeNote> {
    this.requireWrite(input);
    await this.requireManageableNote(input.noteId, input);
    return retractKnowledgeNote(this.service.repository, { ...input, attribution: this.attribution });
  }

  private scope(input: AgentKnowledgeScope) {
    if (!this.policy.projectionKeys.includes(input.projectionKey)) throw new Error(`Agent is not allowed to use knowledge projection ${input.projectionKey}.`);
    if (!this.policy.allowedUses.includes(input.use)) throw new Error(`Agent is not allowed to use knowledge for ${input.use}.`);
    const projection = this.service.compiledRegistry.readProjections.get(input.projectionKey);
    if (!projection || !projection.allowedUses.includes(input.use)) throw new Error(`Knowledge projection ${input.projectionKey} is not available for ${input.use}.`);
    return { organizationId: this.service.organizationId, use: input.use, maxSensitivity: this.policy.maxSensitivity };
  }

  private limit(requested?: number) {
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) throw new Error('Agent knowledge result limit must be a positive integer.');
    return Math.min(requested ?? this.policy.maxResults, this.policy.maxResults);
  }

  private requireWrite(input: AgentKnowledgeScope & { kind?: KnowledgeNoteKind; sensitivity?: KnowledgeSensitivity; allowedUses?: KnowledgeUse[] }) {
    this.scope(input);
    if (!this.policy.canWriteNotes) throw new Error('Agent knowledge policy does not allow note writes.');
    if (input.kind && this.policy.writableNoteKinds?.length && !this.policy.writableNoteKinds.includes(input.kind)) throw new Error(`Agent cannot write ${input.kind} notes.`);
    if (input.sensitivity && sensitivityRank[input.sensitivity] > sensitivityRank[this.policy.maxSensitivity]) throw new Error('Agent cannot write a note above its sensitivity boundary.');
    if (input.allowedUses?.some((use) => !this.policy.allowedUses.includes(use))) throw new Error('Agent cannot write a note for a use outside its policy.');
  }

  private async requireVisibleSubjects(ids: readonly string[], projectionKey: string) {
    for (const id of [...new Set(ids)]) {
      if (!await this.service.entityInProjection(id, projectionKey, this.policy.maxSensitivity)) throw new Error(`Entity is unavailable to this agent in projection ${projectionKey}: ${id}`);
    }
  }

  private async requireWritableSubjects(ids: readonly string[], projectionKey: string) {
    if (ids.length === 0) throw new Error('Agent notes require at least one subject entity.');
    await this.requireVisibleSubjects(ids, projectionKey);
    if (!this.policy.writableEntityTypes?.length) return;
    for (const id of [...new Set(ids)]) {
      const entity = await this.service.entity(id, this.policy.maxSensitivity);
      if (!entity || !entityTypesAreAssignable(this.service.compiledRegistry, entity.typeKeys ?? [entity.typeKey], this.policy.writableEntityTypes)) {
        throw new Error(`Agent cannot attach notes to entity ${id}.`);
      }
    }
  }

  private async requireVisibleClaimEntities(claim: { subjectEntityId: string; object: { kind: 'entity'; entityId: string } | { kind: 'literal' } }, projectionKey: string) {
    await this.requireVisibleSubjects([claim.subjectEntityId, ...(claim.object.kind === 'entity' ? [claim.object.entityId] : [])], projectionKey);
  }

  private async requireBasedOnClaims(ids: readonly string[], scope: AgentKnowledgeScope) {
    if (ids.length > 50) throw new Error('Agent notes can cite at most 50 claims.');
    for (const id of [...new Set(ids)]) {
      if (!await this.explain({ ...scope, id })) throw new Error(`Agent note cannot cite an unavailable claim: ${id}`);
    }
  }

  private async requireManageableNote(noteId: string, scope: AgentKnowledgeScope): Promise<KnowledgeNote> {
    const note = await getKnowledgeNote(this.service.repository, noteId, this.scope(scope));
    if (!note) throw new Error(`Knowledge note is unavailable to this agent: ${noteId}`);
    await this.requireVisibleSubjects(note.subjectEntityIds, scope.projectionKey);
    if (!this.policy.canManageAllNotes && this.attribution.agentId && note.attribution.agentId !== this.attribution.agentId) {
      throw new Error('Agent can revise or retract only notes it authored.');
    }
    return note;
  }
}
