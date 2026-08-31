import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryKnowledgeRepository,
  compileKnowledgeRegistry,
  coreKnowledgeManifest,
  knowledgeRegistry,
} from '@content-automation/knowledge';
import type { DimensionMatch, ObservationRecord } from '../domain/qualification';
import type { Prospect } from '../domain/types';
import { outreachKnowledgeManifest } from '../knowledge-manifest';
import {
  buildOutreachResearchDocument,
  extractOutreachResearchKnowledge,
  ingestProspectRecordKnowledge,
  observationKnowledgeContent,
  partitionAssessmentClaimIds,
} from '../knowledge-service';

const REGISTRY = compileKnowledgeRegistry([coreKnowledgeManifest, outreachKnowledgeManifest]);
knowledgeRegistry.install(REGISTRY);

const BASE = {
  dimensionKey: 'operational_scale',
  evidence: ['https://example.test/source'],
  confidence: 0.9,
  researchedAt: '2026-08-19T00:00:00.000Z',
  runId: 'run-1',
} satisfies Partial<Omit<ObservationRecord, 'id'>>;

test('prospect record projection returns the canonical graph identity and is replay-safe', async () => {
  const repo = new InMemoryKnowledgeRepository('test-prospect-record', REGISTRY);
  const prospect = {
    id: 'prospect-record-1',
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
    title: 'CTO',
    status: 'new',
    source: 'manual',
    priority: 'medium',
    tags: [],
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  } satisfies Prospect;

  const first = await ingestProspectRecordKnowledge(
    { organizationId: repo.organizationId, prospect },
    { repo },
  );
  const entity = await repo.getEntity(first.entityId);
  assert.equal(entity?.externalIds.outreach_prospect, prospect.id);
  assert.ok(entity?.typeKeys.includes('outreach.prospect'));
  assert.equal(first.claimIds.length, 1);
  assert.match((await repo.getClaim(first.claimIds[0]))?.statement ?? '', /Ada Lovelace.*CTO.*Analytical Engines/);

  const replay = await ingestProspectRecordKnowledge(
    { organizationId: repo.organizationId, prospect },
    { repo },
  );
  assert.equal(replay.entityId, first.entityId);
  assert.deepEqual(replay.claimIds, first.claimIds);
});

test('knowledge ingestion stores the observation rather than its source URLs', () => {
  const content = observationKnowledgeContent({
    ...BASE,
    shape: 'prose',
    observedValue: 'The company operates in 20 countries.',
  } as Omit<ObservationRecord, 'id'>);

  assert.equal(content, 'The company operates in 20 countries.');
});

test('knowledge ingestion serializes dated timing signals', () => {
  const content = observationKnowledgeContent({
    ...BASE,
    dimensionKey: 'hiring_activity',
    shape: 'signals',
    signals: [
      {
        signal: 'Opened an AI engineering role',
        date: '2026-08-10',
        evidence: ['https://example.test/job'],
        confidence: 0.8,
      },
    ],
  } as Omit<ObservationRecord, 'id'>);

  assert.equal(content, '2026-08-10: Opened an AI engineering role');
});

test('knowledge ingestion skips valid empty research observations', () => {
  const emptyTiming = observationKnowledgeContent({
    ...BASE,
    dimensionKey: 'funding_events',
    shape: 'signals',
    signals: [],
    evidence: [],
    confidence: 0,
  } as Omit<ObservationRecord, 'id'>);
  const noEvidenceProse = observationKnowledgeContent({
    ...BASE,
    shape: 'prose',
    observedValue: 'No evidence found.',
    evidence: [],
    confidence: 0,
  } as Omit<ObservationRecord, 'id'>);

  assert.equal(emptyTiming, null);
  assert.equal(noEvidenceProse, null);
});

test('assessment claim partition never treats contradictory evidence as support', () => {
  const observations = [
    { ...BASE, id: 'observation-1', shape: 'prose', observedValue: 'Mismatch', claimIds: ['claim-1', 'claim-2'] },
  ] as ObservationRecord[];
  const matches = [
    {
      dimensionKey: BASE.dimensionKey,
      matchScore: 0,
      effectiveMatch: 0,
      classification: 'mismatch',
      hardExclusion: false,
      confidence: 0.9,
      supportingClaimIds: ['claim-1', 'claim-2'],
      contradictingClaimIds: ['claim-2'],
    },
  ] as DimensionMatch[];

  assert.deepEqual(partitionAssessmentClaimIds(observations, matches), {
    supportingClaimIds: ['claim-1'],
    contradictingClaimIds: ['claim-2'],
  });
});

test('batched research extraction creates a subject-connected semantic entity and claim', async () => {
  const observation = {
    ...BASE,
    shape: 'prose',
    observedValue: 'Acme uses vector databases for semantic search.',
    sourceDocuments: [{
      url: 'https://example.test/acme-engineering',
      title: 'Acme engineering',
      content: 'Acme uses vector databases for semantic search. The system launched in 2026.',
      publishedDate: '2026-08-18',
    }],
  } as Omit<ObservationRecord, 'id'>;
  const document = buildOutreachResearchDocument(
    { kind: 'account', id: 'account-1', name: 'Acme' },
    [observation],
  );
  assert.match(document, /SOURCE URL: https:\/\/example\.test\/acme-engineering/);
  assert.match(document, /SOURCE CONTENT:\nAcme uses vector databases for semantic search\./);
  assert.doesNotMatch(document, /Finding:/, 'the model-authored observation is not extraction evidence');

  const repo = new InMemoryKnowledgeRepository('test-organization', REGISTRY);
  const result = await extractOutreachResearchKnowledge({
    entity: { kind: 'account', id: 'account-1', name: 'Acme' },
    observations: [observation],
  }, {
    repo,
    completeJson: async () => ({
      entities: [{
        localKey: 'vector-databases',
        typeKey: 'core.concept',
        name: 'Vector databases',
        aliases: [],
        externalIds: {},
      }],
      claims: [{
        subjectKey: 'subject',
        predicateKey: 'core.related_to',
        object: { kind: 'entity', entityKey: 'vector-databases' },
        statement: 'Acme uses vector databases for semantic search.',
        evidence: [{
          sourceUrl: 'https://example.test/acme-engineering',
          excerpt: 'Acme uses vector databases for semantic search.',
        }],
        confidence: 0.94,
      }],
    }),
  });

  assert.ok(result);
  assert.equal(result.entities.length, 2);
  assert.equal(result.reconciled.claims.length, 1);
  assert.equal(result.reconciled.claims[0]?.object.kind, 'entity');
  assert.deepEqual(result.lineageByDimension.operational_scale.claimIds, [result.reconciled.claims[0]?.id]);
  const evidence = [...repo.evidence.values()][0];
  assert.equal(evidence?.locator, 'https://example.test/acme-engineering');
  assert.equal(evidence?.excerpt, 'Acme uses vector databases for semantic search.');
  assert.ok([...repo.entities.values()].some(({ typeKey, name }) => typeKey === 'core.concept' && name === 'Vector databases'));

  const replay = await extractOutreachResearchKnowledge({
    entity: { kind: 'account', id: 'account-1', name: 'Acme' },
    observations: [observation],
  }, {
    repo,
    completeJson: async () => { throw new Error('cached extraction should not call the model'); },
  });
  assert.equal(replay?.replayed, true);
  assert.deepEqual(replay?.lineageByDimension.operational_scale.claimIds, [result.reconciled.claims[0]?.id]);
});

test('graph extraction reports invalid evidence without rejecting durable research', async () => {
  const observation = {
    ...BASE,
    shape: 'prose',
    observedValue: 'Acme secretly built a quantum computer.',
    sourceDocuments: [{
      url: 'https://example.test/acme',
      title: 'Acme homepage',
      content: 'Acme manufactures ordinary paper clips.',
    }],
  } as Omit<ObservationRecord, 'id'>;
  const repo = new InMemoryKnowledgeRepository('test-no-hallucination', REGISTRY);

  const result = await extractOutreachResearchKnowledge({
      entity: { kind: 'account', id: 'account-2', name: 'Acme' },
      observations: [observation],
    }, {
      repo,
      completeJson: async () => ({
        entities: [
          { localKey: 'quantum', typeKey: 'core.concept', name: 'Quantum computing', aliases: [], externalIds: {} },
          { localKey: 'mystery', typeKey: 'unregistered.type', name: 'Mystery', aliases: [], externalIds: {} },
        ],
        claims: [
          {
            subjectKey: 'subject',
            predicateKey: 'core.related_to',
            object: { kind: 'entity', entityKey: 'quantum' },
            statement: 'Acme built a quantum computer.',
            evidence: [{ sourceUrl: 'https://example.test/acme', excerpt: 'Acme secretly built a quantum computer.' }],
            confidence: 0.9,
          },
          {
            subjectKey: 'subject',
            predicateKey: 'core.related_to',
            object: { kind: 'entity', entityKey: 'mystery' },
            statement: 'Acme relates to Mystery.',
            evidence: [{ sourceUrl: 'https://example.test/acme', excerpt: 'Acme manufactures ordinary paper clips.' }],
            confidence: 0.7,
          },
        ],
      }),
    });
  assert.ok(result);
  assert.equal(result.reconciled.claims.length, 0);
  assert.ok(result.candidates.warnings?.some((warning) => warning.includes('exactly matched')));
  assert.ok(result.candidates.warnings?.some((warning) => warning.includes('unregistered.type')));
  assert.ok(result.candidates.warnings?.some((warning) => warning.includes('entity object "mystery" was not available')));
  assert.ok(result.candidates.warnings?.some((warning) => warning.includes('literal facts and research observations were retained')));
  assert.equal(repo.claims.size, 0);
});

test('graph extraction preserves an evidence-backed literal fact without inventing a relationship', async () => {
  const observation = {
    ...BASE,
    shape: 'prose',
    observedValue: 'Acme employs 120 people.',
    sourceDocuments: [{
      url: 'https://example.test/acme-team',
      title: 'Acme team',
      content: 'Acme employs 120 people.',
    }],
  } as Omit<ObservationRecord, 'id'>;
  const repo = new InMemoryKnowledgeRepository('test-literal-research', REGISTRY);

  const result = await extractOutreachResearchKnowledge({
    entity: { kind: 'account', id: 'account-literal', name: 'Acme' },
    observations: [observation],
  }, {
    repo,
    completeJson: async () => ({
      entities: [],
      claims: [{
        subjectKey: 'subject',
        predicateKey: 'core.has_statement',
        object: { kind: 'literal', value: 'Acme employs 120 people.', valueType: 'string' },
        statement: 'Acme employs 120 people.',
        evidence: [{ sourceUrl: 'https://example.test/acme-team', excerpt: 'Acme employs 120 people.' }],
        confidence: 0.95,
      }],
    }),
  });

  assert.ok(result);
  assert.equal(result.reconciled.claims.length, 1);
  assert.equal(result.reconciled.claims[0]?.object.kind, 'literal');
  assert.ok(result.candidates.warnings?.some((warning) => warning.includes('No evidence-backed entity relationship')));
});

test('raw evidence offsets survive source-document normalization', async () => {
  const observation = {
    ...BASE,
    shape: 'prose',
    observedValue: 'Acme uses vector databases.',
    sourceDocuments: [{
      url: 'https://example.test/normalization',
      title: 'Acme\tengineering',
      content: 'Background.\n\n\n\n\nAcme uses vector databases.',
    }],
  } as Omit<ObservationRecord, 'id'>;
  const repo = new InMemoryKnowledgeRepository('test-normalized-offsets', REGISTRY);

  const result = await extractOutreachResearchKnowledge({
    entity: { kind: 'account', id: 'account-normalization', name: 'Acme' },
    observations: [observation],
  }, {
    repo,
    completeJson: async () => ({
      entities: [{ localKey: 'vector', typeKey: 'core.concept', name: 'Vector databases', aliases: [], externalIds: {} }],
      claims: [{
        subjectKey: 'subject',
        predicateKey: 'core.related_to',
        object: { kind: 'entity', entityKey: 'vector' },
        statement: 'Acme uses vector databases.',
        evidence: [{ sourceUrl: 'https://example.test/normalization', excerpt: 'Acme uses vector databases.' }],
        confidence: 0.9,
      }],
    }),
  });

  assert.equal(result?.reconciled.claims.length, 1);
  assert.equal([...repo.evidence.values()][0]?.excerpt, 'Acme uses vector databases.');
});

test('research corpus samples every dimension before taking more pages from the first', () => {
  const longPage = 'A'.repeat(6_000);
  const observations = [
    {
      ...BASE,
      dimensionKey: 'first_dimension',
      shape: 'prose',
      observedValue: 'First finding',
      sourceDocuments: Array.from({ length: 5 }, (_, index) => ({
        url: `https://example.test/first-${index}`,
        title: `First ${index}`,
        content: longPage,
      })),
    },
    {
      ...BASE,
      dimensionKey: 'late_dimension',
      shape: 'prose',
      observedValue: 'Late finding',
      sourceDocuments: [{
        url: 'https://example.test/late',
        title: 'Late dimension',
        content: 'Evidence from the late dimension.',
      }],
    },
  ] as Array<Omit<ObservationRecord, 'id'>>;

  const document = buildOutreachResearchDocument(
    { kind: 'account', id: 'account-balanced', name: 'Acme' },
    observations,
  );

  assert.match(document, /SOURCE URL: https:\/\/example\.test\/late/);
  assert.ok(document.indexOf('https://example.test/late') < document.indexOf('https://example.test/first-1'));
  assert.ok(document.length <= 58_000);
});
