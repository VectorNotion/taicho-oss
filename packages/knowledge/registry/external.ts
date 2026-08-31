import { createHash } from 'node:crypto';
import { z } from 'zod';
import { knowledgeModuleManifestSchema } from './schema';
import type { KnowledgeModuleManifest } from './types';

export const knowledgeModuleManifestJsonSchema = z.toJSONSchema(knowledgeModuleManifestSchema, { target: 'draft-2020-12' });

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function canonicalManifestPayload(input: unknown): string {
  const manifest = knowledgeModuleManifestSchema.parse(input) as KnowledgeModuleManifest;
  return JSON.stringify(canonicalize(manifest));
}

export function manifestDigest(input: unknown): string {
  return createHash('sha256').update(canonicalManifestPayload(input)).digest('hex');
}

export function loadExternalKnowledgeManifest(input: unknown, options: {
  trustedModuleKeys: ReadonlySet<string>;
  supportedVersions: ReadonlySet<number>;
  signature: string;
  verifySignature: (payload: string, signature: string, moduleKey: string) => boolean;
}): KnowledgeModuleManifest {
  const manifest = knowledgeModuleManifestSchema.parse(input) as KnowledgeModuleManifest;
  if (!options.trustedModuleKeys.has(manifest.moduleKey)) throw new Error(`External knowledge module is not trusted: ${manifest.moduleKey}`);
  if (!options.supportedVersions.has(manifest.version)) throw new Error(`External knowledge module version is not supported: ${manifest.moduleKey}@${manifest.version}`);
  if (!options.signature || !options.verifySignature(canonicalManifestPayload(manifest), options.signature, manifest.moduleKey)) {
    throw new Error(`External knowledge module signature is invalid: ${manifest.moduleKey}`);
  }
  return manifest;
}
