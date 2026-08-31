import assert from 'node:assert/strict';
import test from 'node:test';
import { compileKnowledgeRegistry } from '../registry/compiler';
import { coreKnowledgeManifest } from '../registry/core-manifest';
import { defineKnowledgeManifest } from '../registry/schema';
import { KnowledgeRegistry } from '../registry/registry';

const moduleManifest = defineKnowledgeManifest({
  moduleKey: 'example',
  version: 1,
  knowledge: 'contributes',
  entityTypes: [{ key: 'example.account', name: 'Account', description: 'An organization viewed as an account.', baseKind: 'organization', extends: 'core.organization' }],
  predicates: [{ key: 'example.targets', name: 'Targets', description: 'Targets an account.', subjectTypes: ['core.person'], objectTypes: ['example.account'], objectKind: 'entity' }],
  extractionProfiles: [{ key: 'example.research', name: 'Research', description: 'Extract account research.', entityTypes: ['example.account'], predicates: ['example.targets'], instructions: ['Find explicit account targeting evidence.'] }],
  readProjections: [{ key: 'example.context', name: 'Context', description: 'Read account context.', entityTypes: ['example.account'], predicates: ['example.targets'], allowedUses: ['research'], defaultLimit: 20 }],
  capabilityIds: ['example.account.get'],
  aliases: [{ from: 'example.customer', to: 'example.account', kind: 'type' }],
  migrations: [],
});

test('compilation is stable and resolves the complete module vocabulary', () => {
  const capabilities = new Set(['example.account.get', ...coreKnowledgeManifest.capabilityIds]);
  const first = compileKnowledgeRegistry([moduleManifest, coreKnowledgeManifest], { capabilityIds: capabilities });
  const second = compileKnowledgeRegistry([coreKnowledgeManifest, moduleManifest], { capabilityIds: capabilities });
  assert.equal(first.hash, second.hash);
  assert.equal(first.entityTypes.get('example.account')?.extends, 'core.organization');
  assert.equal(first.aliases.get('type:example.customer'), 'example.account');
  assert.deepEqual(first.capabilityIds, [
    'example.account.get',
    'knowledge.context.query',
    'knowledge.entity.get',
    'knowledge.explain.get',
    'knowledge.coverage.get',
    'knowledge.lookup.request',
    'knowledge.module.activate',
    'knowledge.module.disable',
    'knowledge.modules.list',
    'knowledge.note.create',
    'knowledge.note.retract',
    'knowledge.note.revise',
    'knowledge.notes.query',
    'knowledge.registry.get',
    'knowledge.search',
    'knowledge.traverse',
  ].sort());
});

test('compilation fails closed on collisions and broken references', () => {
  assert.throws(() => compileKnowledgeRegistry([moduleManifest, moduleManifest]), /Duplicate knowledge module/);
  assert.throws(() => compileKnowledgeRegistry([coreKnowledgeManifest, moduleManifest], { capabilityIds: new Set() }), /unknown capability/);
  const broken = defineKnowledgeManifest({
    ...moduleManifest,
    moduleKey: 'broken',
    entityTypes: [{ ...moduleManifest.entityTypes[0], key: 'broken.account', extends: 'core.missing' }],
    predicates: [], extractionProfiles: [], readProjections: [], capabilityIds: [], aliases: [],
  });
  assert.throws(() => compileKnowledgeRegistry([coreKnowledgeManifest, broken]), /unknown parent type/);
});

test('a process registry accepts only one immutable compiled contract', () => {
  const registry = new KnowledgeRegistry();
  const compiled = compileKnowledgeRegistry([coreKnowledgeManifest]);
  registry.install(compiled);
  registry.install(compiled);
  assert.equal(registry.current().hash, compiled.hash);
  assert.throws(
    () => (registry.current().entityTypes as Map<string, unknown>).set('x', {}),
    /set is not a function/i,
  );
});

test('aliases, migrations, and inheritance evolution fail closed', () => {
  const cyclic = defineKnowledgeManifest({
    moduleKey: 'cycle', version: 1, knowledge: 'contributes',
    entityTypes: [
      { key: 'cycle.one', name: 'One', description: 'First cyclic type.', baseKind: 'thing', extends: 'cycle.two' },
      { key: 'cycle.two', name: 'Two', description: 'Second cyclic type.', baseKind: 'thing', extends: 'cycle.one' },
    ],
    predicates: [], extractionProfiles: [], readProjections: [], capabilityIds: [], aliases: [], migrations: [],
  });
  assert.throws(() => compileKnowledgeRegistry([coreKnowledgeManifest, cyclic]), /inheritance cycle/);

  const evolved = defineKnowledgeManifest({
    moduleKey: 'evolved', version: 2, knowledge: 'contributes',
    entityTypes: [{ key: 'evolved.current', name: 'Current', description: 'Current stable type.', baseKind: 'thing', extends: 'core.thing' }],
    predicates: [], extractionProfiles: [], readProjections: [], capabilityIds: [], aliases: [{ from: 'evolved.legacy', to: 'evolved.current', kind: 'type' }],
    migrations: [{ fromVersion: 1, toVersion: 2, replacedBy: { 'evolved.legacy': 'evolved.current' } }],
  });
  assert.ok(compileKnowledgeRegistry([coreKnowledgeManifest, evolved]).aliases.has('type:evolved.legacy'));
  const invalid = defineKnowledgeManifest({ ...evolved, migrations: [{ fromVersion: 2, toVersion: 3, replacedBy: { 'evolved.legacy': 'evolved.missing' } }] });
  assert.throws(() => compileKnowledgeRegistry([coreKnowledgeManifest, invalid]), /invalid migration/);
});
