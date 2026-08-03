import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeIngestRequest } from './contracts'

type ExportedDocument = KnowledgeIngestRequest['documents'][number]

const MAX_WORDS_PER_CHUNK = 650
const OVERLAP_WORDS = 80

async function mdxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return mdxFiles(absolute)
    return entry.isFile() && entry.name.endsWith('.mdx') ? [absolute] : []
  }))
  return files.flat().sort()
}

function frontmatter(source: string): { body: string; title?: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { body: source }
  const title = match[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^title:\s*(.+?)\s*$/)?.[1])
    .find(Boolean)
    ?.replace(/^['"]|['"]$/g, '')
  return { body: source.slice(match[0].length), title }
}

function cleanMdx(source: string): string {
  return source
    .replace(/^(?:import|export)\s+.*$/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sections(source: string): Array<{ heading?: string; content: string }> {
  const result: Array<{ heading?: string; content: string }> = []
  let heading: string | undefined
  let lines: string[] = []
  const flush = () => {
    const content = lines.join('\n').trim()
    if (content) result.push({ heading, content })
    lines = []
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/)
    if (match) {
      flush()
      heading = match[1]
      lines.push(line)
    } else {
      lines.push(line)
    }
  }
  flush()
  return result
}

function wordChunks(content: string): string[] {
  const words = content.split(/\s+/).filter(Boolean)
  if (words.length <= MAX_WORDS_PER_CHUNK) return content ? [content] : []
  const chunks: string[] = []
  for (let start = 0; start < words.length;) {
    const end = Math.min(words.length, start + MAX_WORDS_PER_CHUNK)
    chunks.push(words.slice(start, end).join(' '))
    if (end === words.length) break
    start = Math.max(start + 1, end - OVERLAP_WORDS)
  }
  return chunks
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function publicDocumentUrl(publicBaseUrl: string, relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.mdx$/, '')
  const route = withoutExtension === 'index'
    ? '/'
    : `/${withoutExtension.replace(/\/index$/, '')}`
  return new URL(route, `${publicBaseUrl.replace(/\/+$/, '')}/`).toString()
}

export async function buildDocsCorpus(
  contentDirectory: string,
  publicBaseUrl = 'https://docs.taicho.ai',
): Promise<ExportedDocument[]> {
  const documents: ExportedDocument[] = []
  for (const file of await mdxFiles(contentDirectory)) {
    const relativePath = path.relative(contentDirectory, file).split(path.sep).join('/')
    const parsed = frontmatter(await readFile(file, 'utf8'))
    const cleaned = cleanMdx(parsed.body)
    const firstHeading = cleaned.match(/^#\s+(.+)$/m)?.[1]
    const title = parsed.title ?? firstHeading ?? path.basename(file, '.mdx')
    const url = publicDocumentUrl(publicBaseUrl, relativePath)
    for (const [sectionIndex, section] of sections(cleaned).entries()) {
      for (const [chunkIndex, content] of wordChunks(section.content).entries()) {
        const sourceId = [
          'docs',
          relativePath.replace(/\.mdx$/, ''),
          slug(section.heading ?? 'overview') || `section-${sectionIndex + 1}`,
          chunkIndex + 1,
        ].join(':')
        documents.push({
          sourceId,
          title,
          url,
          heading: section.heading,
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          pagePath: new URL(url).pathname,
          metadata: {
            relativePath,
            sectionIndex,
            chunkIndex,
          },
        })
      }
    }
  }
  return documents
}
