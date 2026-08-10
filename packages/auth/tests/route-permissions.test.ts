import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { permissionForRequest, type ProductId } from '../permissions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry);
    if ((await stat(absolute)).isDirectory()) files.push(...await routeFiles(absolute));
    else if (entry === 'route.ts') files.push(absolute);
  }
  return files;
}

function apiPath(file: string): string {
  return `/${path.relative(path.join(root, 'apps/unified/app'), file)}`
    .replaceAll(path.sep, '/')
    .replace(/\/route\.ts$/, '')
    .replace(/\[[^/]+\]/g, 'test-id');
}

for (const product of ['content', 'outreach', 'cascade'] as ProductId[]) {
  test(`every ${product} API route is classified as a ${product} permission`, async () => {
    const directory = path.join(root, 'apps/unified/app/api', product);
    for (const file of await routeFiles(directory)) {
      const pathname = apiPath(file);
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        assert.equal(
          permissionForRequest(pathname, method)?.product,
          product,
          `${method} ${pathname}`,
        );
      }
    }
  });
}

test('streaming endpoints require the same permission as their synchronous sibling', () => {
  const pairs = [
    ['/api/content/generate-ideas', '/api/content/generate-ideas/stream'],
    ['/api/content/ideas/test-id/refine', '/api/content/ideas/test-id/refine/stream'],
    ['/api/content/ideas/test-id/draft', '/api/content/ideas/test-id/draft/stream'],
    ['/api/content/projects/test-id/ingest', '/api/content/projects/test-id/ingest/stream'],
    ['/api/content/research/run', '/api/content/research/run/stream'],
    ['/api/content/topics/generate', '/api/content/topics/generate/stream'],
    ['/api/outreach/prospects/test-id/qualify', '/api/outreach/prospects/test-id/qualify/stream'],
  ] as const;

  for (const [synchronous, streaming] of pairs) {
    assert.deepEqual(
      permissionForRequest(streaming, 'POST'),
      permissionForRequest(synchronous, 'POST'),
      streaming,
    );
  }
});

test('special operations map to their least-privilege actions', () => {
  assert.deepEqual(permissionForRequest('/api/content/research/run/stream', 'POST'), { product: 'content', action: 'research' });
  assert.deepEqual(permissionForRequest('/api/content/projects/test-id/ingest/stream', 'POST'), { product: 'content', action: 'generate' });
  assert.deepEqual(permissionForRequest('/api/content/ideas/test-id/draft/stream', 'POST'), { product: 'content', action: 'generate' });
  assert.deepEqual(permissionForRequest('/api/outreach/prospects/test-id/qualify/stream', 'POST'), { product: 'outreach', action: 'qualify' });
  assert.deepEqual(permissionForRequest('/api/content/channels/callback/linkedin', 'GET'), { product: 'content', action: 'read' });
  assert.deepEqual(permissionForRequest('/api/cascade/funnels/test-id/emails/email-id', 'PATCH'), { product: 'cascade', action: 'update' });
});
