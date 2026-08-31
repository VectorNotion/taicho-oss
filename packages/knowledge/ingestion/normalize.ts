import { createHash } from 'node:crypto';
import type { SourceDocument } from './source-adapter';

export interface NormalizedSourceDocument extends SourceDocument {
  canonicalUri: string;
  content: string;
  contentHash: string;
}

export function cleanSourceContent(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export function normalizeCanonicalUri(value: string): string {
  const trimmed = value.trim().normalize('NFKC');
  try {
    const url = new URL(trimmed);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function normalizeSourceDocument(input: SourceDocument): NormalizedSourceDocument {
  const content = cleanSourceContent(input.content);
  if (!content) throw new Error('Knowledge sources require non-empty content.');
  return {
    ...input,
    canonicalUri: normalizeCanonicalUri(input.canonicalUri),
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}
