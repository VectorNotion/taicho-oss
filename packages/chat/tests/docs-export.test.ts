import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildDocsCorpus } from '../docs-export'

test('documentation exporter creates stable, clean, heading-scoped chunks', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'taicho-docs-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'guides'))
  await writeFile(path.join(directory, 'guides', 'prospect-api.mdx'), `---
title: "Create prospects"
---
import { Callout } from '@content-automation/ui'

# Create prospects

Send a request to the prospect API.

## Required columns

Email is required. <Callout>Names are optional.</Callout>
`)

  const documents = await buildDocsCorpus(directory, 'https://docs.taicho.ai')
  assert.equal(documents.length, 2)
  assert.equal(documents[0].title, 'Create prospects')
  assert.equal(documents[0].url, 'https://docs.taicho.ai/guides/prospect-api')
  assert.match(documents[0].sourceId, /^docs:guides\/prospect-api:/)
  assert.doesNotMatch(documents[0].content, /import \{/)
  assert.doesNotMatch(documents[1].content, /<Callout>/)
  assert.match(documents[1].contentHash, /^[a-f0-9]{64}$/)
})
