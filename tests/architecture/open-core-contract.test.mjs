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
  'packages/knowledge',
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

test('the mirror sync allowlist covers every open-core workspace', async () => {
  const workflowPath = path.join(root, '.github/workflows/sync-mirror.yml');
  let workflow;
  try {
    workflow = await readFile(workflowPath, 'utf8');
  } catch {
    return; // The public mirror does not carry the sync workflow.
  }

  const match = workflow.match(/ALLOWLIST=\(([^)]*)\)/);
  assert.ok(match, 'sync-mirror.yml no longer contains an ALLOWLIST block');
  const allowlist = match[1].split('\n').map((line) => line.trim()).filter(Boolean);
  const uncovered = openCoreWorkspaces.filter(
    (workspace) => !allowlist.some((entry) => workspace === entry || workspace.startsWith(`${entry}/`)),
  );

  // A workspace in the open-core contract that the sync never exports leaves
  // the mirror unable to install: exported apps depend on it by workspace
  // protocol, so the standalone verify fails and no sync ships.
  assert.deepEqual(uncovered, [], 'open-core workspaces missing from the sync-mirror allowlist');
});

// The standalone v1 catch-all is sanctioned: it is stripped from the mirror
// export by sync-mirror.yml, so it may dispatch through the private unified
// app in this repository while never reaching the open-core tree.
const sanctionedPrivatePathImports = new Set([
  "apps/content-generator/app/api/v1/[...path]/route.ts",
]);

test("open-core workspaces do not path-import private workspaces", async () => {
  const privatePathImport = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]@\/(?:apps\/(?:unified|cms)|ops|docker|extension-react|services)\//;
  const violations = [];

  for (const workspace of openCoreWorkspaces) {
    for (const file of await filesUnder(workspace)) {
      if (sanctionedPrivatePathImports.has(path.relative(root, file))) continue;
      const content = await readFile(file, "utf8");
      content.split("\n").forEach((line, index) => {
        if (privatePathImport.test(line)) {
          violations.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(violations, []);
});
