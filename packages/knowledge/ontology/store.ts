import { getSession } from '@content-automation/platform/data/graph';
import { stableKnowledgeId, type CanonicalEntity } from '../domain';
import { normalizeEntityName } from '../identity';
import {
  ONTOLOGY_SCHEMA_VERSION,
  type OntologyEvent,
  type OntologyEventKind,
  type OntologyVeto,
  type TypeCandidate,
} from './types';

type Session = Awaited<ReturnType<typeof getSession>>;

/**
 * Graph-backed store for the self-curating ontology's working state:
 * type candidates, the append-only event log, and veto memory. Follows the
 * FalkorKnowledgeRepository convention — JSON payload nodes keyed by id,
 * scalar properties only where filtering needs them.
 */
export class OntologyStore {
  constructor(readonly organizationId: string) {}

  async #withSession<T>(run: (session: Session) => Promise<T>): Promise<T> {
    const session = await getSession(this.organizationId);
    try { return await run(session); } finally { await session.close(); }
  }

  async #putJson(session: Session, label: string, id: string, json: unknown, status?: string) {
    await session.run(
      `MERGE (n:${label} {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId})
       SET n.json = $json, n.status = $status`,
      { id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, json: JSON.stringify(json), status: status ?? null },
    );
  }

  async #loadJson<T>(label: string, where = '', params: Record<string, unknown> = {}): Promise<T[]> {
    return this.#withSession(async (session) => {
      const result = await session.run(
        `MATCH (n:${label} {schemaVersion: $schemaVersion, organizationId: $organizationId})${where} RETURN n.json AS json`,
        { schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, ...params },
      );
      return result.records.map((record) => JSON.parse(String(record.get('json'))) as T);
    });
  }

  /**
   * Record one observation of an untypeable concept. Merges with the existing
   * open candidate for the same normalized surface + base kind: recurrence
   * increments only when a new document contributes the observation.
   */
  async recordCandidateObservation(input: {
    surface: string;
    proposedTypeName: string;
    definition: string;
    baseKind: TypeCandidate['baseKind'];
    profileKey: string;
    evidence: string;
    docRef: string;
    entityId?: string;
  }): Promise<TypeCandidate> {
    const normalizedSurface = normalizeEntityName(input.surface);
    const id = stableKnowledgeId('typecandidate', this.organizationId, normalizedSurface, input.baseKind);
    const now = new Date().toISOString();
    const [existing] = await this.#loadJson<TypeCandidate>('TypeCandidate', ' WHERE n.id = $candidateId', { candidateId: id });
    if (existing && (existing.status === 'vetoed' || existing.status === 'promoted')) return existing;
    const docRefs = [...new Set([...(existing?.docRefs ?? []), input.docRef])].sort();
    const candidate: TypeCandidate = {
      id,
      schemaVersion: ONTOLOGY_SCHEMA_VERSION,
      organizationId: this.organizationId,
      surface: existing?.surface ?? input.surface,
      normalizedSurface,
      proposedTypeName: existing?.proposedTypeName ?? input.proposedTypeName,
      normalizedProposedTypeName: normalizeEntityName(existing?.proposedTypeName ?? input.proposedTypeName),
      definition: existing?.definition ?? input.definition,
      baseKind: input.baseKind,
      profileKey: input.profileKey,
      evidence: input.evidence.slice(0, 500),
      docRefs,
      entityIds: [...new Set([...(existing?.entityIds ?? []), ...(input.entityId ? [input.entityId] : [])])].sort(),
      recurrence: docRefs.length,
      status: 'open',
      embedding: existing?.embedding,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.#withSession((session) => this.#putJson(session, 'TypeCandidate', candidate.id, candidate, candidate.status));
    return candidate;
  }

  async saveCandidate(candidate: TypeCandidate): Promise<void> {
    await this.#withSession((session) => this.#putJson(session, 'TypeCandidate', candidate.id, candidate, candidate.status));
  }

  async listCandidates(status?: TypeCandidate['status']): Promise<TypeCandidate[]> {
    const values = await this.#loadJson<TypeCandidate>('TypeCandidate', status ? ' WHERE n.status = $wantedStatus' : '', status ? { wantedStatus: status } : {});
    return values.sort((left, right) => right.recurrence - left.recurrence || left.normalizedSurface.localeCompare(right.normalizedSurface));
  }

  async recordEvent(kind: OntologyEventKind, summary: string, detail: Record<string, unknown> = {}): Promise<OntologyEvent> {
    const at = new Date().toISOString();
    const event: OntologyEvent = {
      id: stableKnowledgeId('ontologyevent', this.organizationId, kind, at, summary),
      schemaVersion: ONTOLOGY_SCHEMA_VERSION,
      organizationId: this.organizationId,
      kind,
      summary,
      detail,
      at,
    };
    await this.#withSession((session) => this.#putJson(session, 'OntologyEvent', event.id, event));
    return event;
  }

  async listEvents(limit = 100): Promise<OntologyEvent[]> {
    const values = await this.#loadJson<OntologyEvent>('OntologyEvent');
    return values.sort((left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id)).slice(0, limit);
  }

  async recordVeto(input: { normalizedName: string; typeKey?: string; reason?: string }): Promise<OntologyVeto> {
    const veto: OntologyVeto = {
      id: stableKnowledgeId('ontologyveto', this.organizationId, input.normalizedName),
      schemaVersion: ONTOLOGY_SCHEMA_VERSION,
      organizationId: this.organizationId,
      normalizedName: input.normalizedName,
      typeKey: input.typeKey,
      reason: input.reason,
      at: new Date().toISOString(),
    };
    await this.#withSession((session) => this.#putJson(session, 'OntologyVeto', veto.id, veto));
    return veto;
  }

  async listVetoes(): Promise<OntologyVeto[]> {
    return this.#loadJson<OntologyVeto>('OntologyVeto');
  }

  /** Load every canonical entity in the organization graph. */
  async listEntities(): Promise<CanonicalEntity[]> {
    return this.#loadJson<CanonicalEntity>('CanonicalEntity');
  }

  /** Per-type metadata for learned types (creation time, lifecycle status). */
  async saveLearnedTypeRecord(record: { key: string; name: string; description: string; baseKind: TypeCandidate['baseKind']; createdAt: string; status: 'active' | 'removed'; removedAt?: string }): Promise<void> {
    const id = stableKnowledgeId('learnedtype', this.organizationId, record.key);
    await this.#withSession((session) => this.#putJson(session, 'LearnedType', id, { id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, ...record }, record.status));
  }

  async listLearnedTypeRecords(): Promise<Array<{ key: string; name: string; description: string; baseKind: TypeCandidate['baseKind']; createdAt: string; status: 'active' | 'removed'; removedAt?: string }>> {
    const values = await this.#loadJson<{ key: string; name: string; description: string; baseKind: TypeCandidate['baseKind']; createdAt: string; status: 'active' | 'removed'; removedAt?: string }>('LearnedType');
    return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key));
  }

  /** Add a type key to entities that were stored under a generic kind. */
  async retypeEntities(entityIds: readonly string[], typeKey: string): Promise<number> {
    if (entityIds.length === 0) return 0;
    let updated = 0;
    await this.#withSession(async (session) => {
      for (const entityId of entityIds) {
        const result = await session.run(
          `MATCH (n:CanonicalEntity {id: $entityId, schemaVersion: $schemaVersion, organizationId: $organizationId}) RETURN n.json AS json`,
          { entityId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        const raw = result.records[0]?.get('json');
        if (!raw) continue;
        const entity = JSON.parse(String(raw)) as CanonicalEntity;
        const typeKeys = [...new Set([...(entity.typeKeys ?? [entity.typeKey]), typeKey])].sort();
        if (typeKeys.length === (entity.typeKeys ?? [entity.typeKey]).length) continue;
        const next = { ...entity, typeKeys, updatedAt: new Date().toISOString() };
        await session.run(
          `MATCH (n:CanonicalEntity {id: $entityId, schemaVersion: $schemaVersion, organizationId: $organizationId}) SET n.json = $json, n.updatedAt = $updatedAt`,
          { entityId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, json: JSON.stringify(next), updatedAt: next.updatedAt },
        );
        updated += 1;
      }
    });
    return updated;
  }

  /**
   * Merge duplicate entities into a survivor: claims are rewritten to the
   * survivor, the duplicate's names become aliases, and the duplicate node is
   * removed. Merges are additive — no claim or evidence is lost.
   */
  async mergeEntities(survivorId: string, duplicateId: string): Promise<boolean> {
    return this.#withSession(async (session) => {
      const load = async (id: string) => {
        const result = await session.run(
          `MATCH (n:CanonicalEntity {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}) RETURN n.json AS json`,
          { id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        const raw = result.records[0]?.get('json');
        return raw ? (JSON.parse(String(raw)) as CanonicalEntity) : null;
      };
      const survivor = await load(survivorId);
      const duplicate = await load(duplicateId);
      if (!survivor || !duplicate) return false;
      const now = new Date().toISOString();
      const merged: CanonicalEntity = {
        ...survivor,
        typeKeys: [...new Set([...(survivor.typeKeys ?? [survivor.typeKey]), ...(duplicate.typeKeys ?? [duplicate.typeKey])])].sort(),
        aliases: [...new Set([...survivor.aliases, ...duplicate.aliases, duplicate.normalizedName].filter((alias) => alias && alias !== survivor.normalizedName))].sort(),
        externalIds: { ...duplicate.externalIds, ...survivor.externalIds },
        updatedAt: now,
      };
      await session.run(
        `MATCH (n:CanonicalEntity {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}) SET n.json = $json, n.updatedAt = $updatedAt`,
        { id: survivorId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, json: JSON.stringify(merged), updatedAt: now },
      );
      // Rewrite claim payloads that reference the duplicate, then re-point edges.
      const claims = await session.run(
        `MATCH (c:Claim {schemaVersion: $schemaVersion, organizationId: $organizationId}) RETURN c.json AS json`,
        { schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      for (const record of claims.records) {
        const claim = JSON.parse(String(record.get('json'))) as { id: string; subjectEntityId: string; object: { kind: string; entityId?: string } };
        const touchesSubject = claim.subjectEntityId === duplicateId;
        const touchesObject = claim.object.kind === 'entity' && claim.object.entityId === duplicateId;
        if (!touchesSubject && !touchesObject) continue;
        const next = {
          ...claim,
          subjectEntityId: touchesSubject ? survivorId : claim.subjectEntityId,
          object: touchesObject ? { ...claim.object, entityId: survivorId } : claim.object,
        };
        await session.run(
          `MATCH (c:Claim {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}) SET c.json = $json`,
          { id: claim.id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId, json: JSON.stringify(next) },
        );
        if (touchesSubject) await session.run(
          `MATCH (c:Claim {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId})
           OPTIONAL MATCH (c)-[old:SUBJECT]->() DELETE old`,
          { id: claim.id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        if (touchesObject) await session.run(
          `MATCH (c:Claim {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId})
           OPTIONAL MATCH (c)-[old:OBJECT]->() DELETE old`,
          { id: claim.id, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        if (touchesSubject) await session.run(
          `MATCH (c:Claim {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}), (s:CanonicalEntity {id: $survivorId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (c)-[:SUBJECT]->(s)`,
          { id: claim.id, survivorId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
        if (touchesObject) await session.run(
          `MATCH (c:Claim {id: $id, schemaVersion: $schemaVersion, organizationId: $organizationId}), (o:CanonicalEntity {id: $survivorId, schemaVersion: $schemaVersion, organizationId: $organizationId}) MERGE (c)-[:OBJECT]->(o)`,
          { id: claim.id, survivorId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
        );
      }
      // Re-point non-knowledge references (e.g. Project KNOWLEDGE_HAS) and drop the duplicate.
      await session.run(
        `MATCH (any)-[r:KNOWLEDGE_HAS]->(d:CanonicalEntity {id: $duplicateId, schemaVersion: $schemaVersion, organizationId: $organizationId}),
               (s:CanonicalEntity {id: $survivorId, schemaVersion: $schemaVersion, organizationId: $organizationId})
         MERGE (any)-[:KNOWLEDGE_HAS]->(s) DELETE r`,
        { duplicateId, survivorId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      await session.run(
        `MATCH (d:CanonicalEntity {id: $duplicateId, schemaVersion: $schemaVersion, organizationId: $organizationId}) DETACH DELETE d`,
        { duplicateId, schemaVersion: ONTOLOGY_SCHEMA_VERSION, organizationId: this.organizationId },
      );
      return true;
    });
  }
}
