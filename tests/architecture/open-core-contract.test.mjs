import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

/**
 * The open-core boundary. Workspaces listed here are the public export set —
 * the subset a self-hoster receives. They must build and run without any of
 * the commercial workspaces below, so nothing here may import one, and their
 * package.json files may not declare one as a dependency. Billing and
 * resonance cross the boundary only through the platform seams
 * (`packages/platform/commercial`, `packages/platform/resonance`), whose
 * defaults are unmetered / unavailable; the commercial deployment swaps the
 * real providers in at boot via the `register` modules.
 */
const openCoreWorkspaces = [
  'apps/content-generator',
  'apps/outreach',
  'apps/docs',
  'apps/styleguide',
  'apps/chatbot-spec',
  'products/content-generator',
  'products/outreach',
  'products/cascade',
  'packages/platform',
  'packages/ui',
  'packages/atlas',
  'packages/auth',
  'packages/chat',
  'packages/database',
  'packages/observability',
  'packages/config',
];

const commercialPackages = [
  '@content-automation/commerce',
  '@content-automation/resonance',
  '@content-automation/intelligence',
  '@content-automation/capabilities',
  '@content-automation/mcp',
  '@content-automation/unified-app',
];

async function filesUnder(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries) {
    if (['.next', '.turbo', 'node_modules', 'build', 'out'].includes(entry)) {
      continue;
    }
    const absolutePath = path.join(directory, entry);
    const entryStat = await stat(absolutePath);
    if (entryStat.isDirectory()) {
      files.push(...await filesUnder(path.relative(root, absolutePath)));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) {
      files.push(absolutePath);
    }
  }

  return files;
}

test('open-core workspaces do not import commercial packages', async () => {
  const importPattern = new RegExp(
    `(?:from\\s+|import\\s*\\(\\s*|require\\(\\s*)['"](${commercialPackages.join('|').replaceAll('/', '\\/')})(?:['"/])`,
  );
  const violations = [];

  for (const workspace of openCoreWorkspaces) {
    for (const file of await filesUnder(workspace)) {
      const content = await readFile(file, 'utf8');
      content.split('\n').forEach((line, index) => {
        if (importPattern.test(line)) {
          violations.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(violations, []);
});

test('open-core package.json files do not declare commercial dependencies', async () => {
  const violations = [];

  for (const workspace of openCoreWorkspaces) {
    const manifest = JSON.parse(await readFile(path.join(root, workspace, 'package.json'), 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (commercialPackages.includes(name)) {
          violations.push(`${workspace}/package.json ${section}: ${name}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('platform seams keep their self-hosted defaults exported', async () => {
  const commercialSeam = await readFile(path.join(root, 'packages/platform/commercial/provider.ts'), 'utf8');
  assert.match(commercialSeam, /class UnmeteredCommercialProvider/);
  assert.match(commercialSeam, /export function setCommercialProvider/);

  const resonanceSeam = await readFile(path.join(root, 'packages/platform/resonance/provider.ts'), 'utf8');
  assert.match(resonanceSeam, /setResonanceRunsProvider/);
  assert.match(resonanceSeam, /501/);
});
