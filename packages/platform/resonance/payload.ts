import { z } from 'zod'
import {
  RESONANCE_FRAMES,
  RESONANCE_SURFACES,
  type ResonancePollPayload,
  type RunRequest,
  type RunEstimate,
  type WebhookPayload,
} from './types'

export const AUDIENCE_MIN = 100
export const AUDIENCE_MAX = 2_000_000
export const CELL_CAP = 20_000_000
const DEFAULT_FRAMES = ['scroll_stop', 'click', 'compelling'] as const

const runRequestSchema = z.object({
  creatives: z.array(z.object({
    id: z.string().min(1).max(100),
    text: z.string().min(1).max(5000),
  })).min(2).max(20),
  audienceSize: z.number().int().min(AUDIENCE_MIN).max(AUDIENCE_MAX),
  frames: z.array(z.enum(RESONANCE_FRAMES)).min(1).max(4).default([...DEFAULT_FRAMES]),
  surface: z.enum(RESONANCE_SURFACES).default('generic'),
  seed: z.number().int().min(0).default(0),
})

export function parseRunRequest(body: unknown): RunRequest {
  const run = runRequestSchema.parse(body)
  const cells = run.creatives.length * run.frames.length * run.audienceSize
  if (cells > CELL_CAP) {
    throw new z.ZodError([{ code: 'custom', path: ['audienceSize'], message: `run exceeds ${CELL_CAP} cells` }])
  }
  return run
}

export function estimateRun(run: RunRequest): RunEstimate {
  const cells = run.creatives.length * run.frames.length * run.audienceSize
  return { cells, credits: Math.max(1, Math.ceil(cells / 1000)) }
}

/**
 * Schema for what the Modal worker returns.
 *
 * This is a money-path boundary, not a convenience: `cellsDone` flows straight
 * into `Math.max(1, Math.ceil(payload.cellsDone / 1000))` as the ACTUAL credits
 * settled against the customer's reservation. An absent or renamed field used
 * to produce `NaN` credits and a `NaN` `usage_event` row while marking the
 * reservation settled — an unrecoverable billing corruption caused by a typo on
 * the other side of the wire. Every other boundary in this package is
 * zod-validated; this one now is too.
 *
 * Unknown keys are stripped rather than rejected: `orchestrate` deliberately
 * returns debug-only extras (`wallClockSeconds`, `shardsTotal`, `shardsFailed`)
 * that the platform has no interest in, and a new debug field on the worker
 * must never fail a run that scored correctly.
 */
const creativeScoreSchema = z.object({
  creativeId: z.string().min(1),
  score: z.number().finite().nullable(),
  ci95: z.tuple([z.number().finite(), z.number().finite()]).nullable(),
  perFrame: z.record(z.string(), z.number().finite()),
  insufficientData: z.boolean().optional(),
})

const voteSnapshotSchema = z.object({
  sequence: z.number().int().min(0),
  tallies: z.array(z.object({
    creativeId: z.string().min(1),
    frame: z.enum(RESONANCE_FRAMES),
    up: z.number().int().min(0),
    down: z.number().int().min(0),
  })).max(80),
  recent: z.array(z.object({
    id: z.string().min(1),
    audienceMember: z.number().int().min(1),
    creativeId: z.string().min(1),
    frame: z.enum(RESONANCE_FRAMES),
    vote: z.enum(['up', 'down']),
    yesProbability: z.number().finite().min(0).max(1),
  })).max(24),
})

const runProgressSchema = z.object({
  stage: z.enum(['queued', 'scoring', 'ranking']),
  cellsDone: z.number().int().min(0),
  cellsTotal: z.number().int().min(0),
  shardsDone: z.number().int().min(0),
  shardsTotal: z.number().int().min(0),
  voteSnapshot: voteSnapshotSchema.optional(),
})

const runResultSchema = z.object({
  scores: z.array(creativeScoreSchema),
  winner: z.object({
    creativeId: z.string().min(1).nullable(),
    margin: z.number().finite(),
    tooCloseToCall: z.boolean(),
  }),
  audienceSize: z.number().int().min(0),
  cellsDone: z.number().int().min(0),
  model: z.string(),
  gpuSeconds: z.number().finite().min(0),
  usdCost: z.number().finite().min(0),
  voteSnapshot: voteSnapshotSchema.optional(),
  partial: z.boolean().optional(),
  degradedReason: z.string().optional(),
})

export const modalResultSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(['complete', 'partial', 'failed']),
  cellsDone: z.number().int().min(0),
  result: runResultSchema.optional(),
  error: z.string().optional(),
  progress: runProgressSchema.optional(),
})

const runningPayloadSchema = z.object({
  status: z.literal('running'),
  progress: runProgressSchema,
})

/** Throws (a `ResonanceMalformedResultError`) rather than returning a partly-typed object — see `modalResultSchema`. */
export function parseModalResult(body: unknown): WebhookPayload {
  const parsed = modalResultSchema.safeParse(body)
  if (!parsed.success) {
    throw new ResonanceMalformedResultError(parsed.error)
  }
  return parsed.data as WebhookPayload
}

export function parseResonancePoll(body: unknown): ResonancePollPayload {
  const running = runningPayloadSchema.safeParse(body)
  if (running.success) return running.data
  return parseModalResult(body)
}

/**
 * A structurally invalid result from Modal. Deliberately NOT a
 * `ResonanceResultGoneError`: a malformed body is treated exactly like a failed
 * poll (logged, swallowed by `reconcileRun`, job left `processing`) so a
 * deploy-skew bug is recoverable by fixing the worker, never by silently
 * charging or cancelling a run that may well have succeeded.
 */
export class ResonanceMalformedResultError extends Error {
  readonly issues: z.ZodIssue[]
  constructor(error: z.ZodError) {
    super(`Modal result payload failed validation: ${error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
    this.name = 'ResonanceMalformedResultError'
    this.issues = error.issues
  }
}
