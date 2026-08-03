export const RESONANCE_FRAMES = ['scroll_stop', 'click', 'share', 'compelling'] as const
export type ResonanceFrame = (typeof RESONANCE_FRAMES)[number]

/**
 * The content surface changes what each scoring frame means. A "click" on a
 * YouTube video is watch intent; on an ad it is destination intent. Keeping
 * the surface as a closed contract lets the worker use format-aware prompts
 * without accepting arbitrary customer-supplied scoring instructions.
 */
export const RESONANCE_SURFACES = [
  'generic',
  'youtube_video',
  'blog_article',
  'x_post',
  'x_thread',
  'linkedin_post',
  'social_post',
  'ad_campaign',
] as const
export type ResonanceSurface = (typeof RESONANCE_SURFACES)[number]

export interface Creative { id: string; text: string }

export interface RunRequest {
  creatives: Creative[]
  audienceSize: number
  frames: ResonanceFrame[]
  surface: ResonanceSurface
  seed: number
}

export interface RunEstimate { cells: number; credits: number }

export interface ResonanceVoteTally {
  creativeId: string
  frame: ResonanceFrame
  up: number
  down: number
}

export interface ResonanceLiveVote {
  /** Stable within a run: candidate + frame + anonymous audience-member index. */
  id: string
  audienceMember: number
  creativeId: string
  frame: ResonanceFrame
  vote: 'up' | 'down'
  /** Full model propensity retained so the UI can describe reaction strength honestly. */
  yesProbability: number
}

/**
 * Compact projection of the completed cells in a long-running Modal job.
 * Totals are exact; `recent` is deliberately bounded by the worker so the
 * browser never receives millions of individual events.
 */
export interface ResonanceVoteSnapshot {
  sequence: number
  tallies: ResonanceVoteTally[]
  recent: ResonanceLiveVote[]
}

export interface ResonanceRunProgress {
  stage: 'queued' | 'scoring' | 'ranking'
  cellsDone: number
  cellsTotal: number
  shardsDone: number
  shardsTotal: number
  /** Optional during a staggered worker rollout. */
  voteSnapshot?: ResonanceVoteSnapshot
}

export interface ResonanceRunningPayload {
  status: 'running'
  progress: ResonanceRunProgress
}

export interface CreativeScore {
  creativeId: string
  /**
   * 0-100. `null` when `insufficientData` is true — every shard for this
   * creative failed, or no draw index survived in every frame, so there is no
   * score to report. It is NOT 0: a zero would rank as a real (terrible)
   * result and could not be told apart from a genuinely unappealing creative.
   */
  score: number | null
  /** Same 0-100 scale as `score`; `null` under `insufficientData`. */
  ci95: [number, number] | null
  /**
   * Per-frame mean, on the SAME 0-100 scale as `score` (NOT the raw 0-1
   * probability). Both producers — `resonance_core/aggregate.py` and
   * `StubTrigger` — are held to this by the shared contract fixture
   * `domain/result-contract.json`.
   */
  perFrame: Record<string, number>
  /** True when this creative produced no usable values; `score`/`ci95` are then `null`. */
  insufficientData?: boolean
}

export interface RunResult {
  scores: CreativeScore[]
  /** `creativeId` is `null` only when NO creative in the run could be scored. */
  winner: { creativeId: string | null; margin: number; tooCloseToCall: boolean }
  audienceSize: number
  cellsDone: number
  model: string
  gpuSeconds: number
  usdCost: number
  /** Final durable snapshot, so completed runs and refreshes retain the feed. */
  voteSnapshot?: ResonanceVoteSnapshot
  /**
   * True when the run completed with shard failures (Modal `status: "partial"`).
   * Carried in the job `result` — not only in `job.error` — because a partial
   * run lands in job status `completed`, and a UI that only reads `error` on
   * `failed` would render a degraded run as a confident, complete result.
   */
  partial?: boolean
  /** Human-readable description of what was lost, e.g. "1/12 shards failed to score". */
  degradedReason?: string
}

/**
 * The result shape the Modal worker returns from `orchestrate` (still named
 * `WebhookPayload` from the superseded push design; it is now a poll response).
 * Validated with `parseModalResult` before any of it reaches the money path.
 */
export interface WebhookPayload {
  jobId: string
  status: 'complete' | 'partial' | 'failed'
  cellsDone: number
  result?: RunResult
  error?: string
  /** Terminal response carries the last snapshot even if the browser missed the final shard update. */
  progress?: ResonanceRunProgress
}

export type ResonancePollPayload = WebhookPayload | ResonanceRunningPayload
