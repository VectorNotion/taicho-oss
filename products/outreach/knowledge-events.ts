import { registerKnowledgeEventAdapter } from '@content-automation/knowledge/events/projector';
import { z } from 'zod';
import { ingestOutreachTranscriptKnowledge } from './knowledge-service';

export const OUTREACH_TRANSCRIPT_KNOWLEDGE_EVENT = 'knowledge.outreach.transcript.ready';

export const outreachTranscriptKnowledgeEventSchema = z.object({
  prospect: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  sourceId: z.string().min(1),
  provider: z.string().min(1),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  utterances: z.array(z.object({
    sourceKey: z.string().min(1),
    content: z.string().min(1),
    speakerName: z.string().nullable().optional(),
    speakerExternalId: z.string().nullable().optional(),
    speakerIsHost: z.boolean().nullable().optional(),
    offsetMs: z.number().nullable().optional(),
    confidence: z.number().nullable().optional(),
  })).min(1),
});

const projectTranscript = async (event: { organizationId: string; payload: Record<string, unknown> }) => {
  const payload = outreachTranscriptKnowledgeEventSchema.parse(event.payload);
  await ingestOutreachTranscriptKnowledge({ organizationId: event.organizationId, ...payload });
  return 'projected' as const;
};

export function registerOutreachKnowledgeEventAdapters(): void {
  registerKnowledgeEventAdapter(OUTREACH_TRANSCRIPT_KNOWLEDGE_EVENT, projectTranscript);
}
