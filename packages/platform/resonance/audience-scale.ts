import { AUDIENCE_MIN, AUDIENCE_MAX, CELL_CAP } from './payload'

/**
 * localStorage key for the user's persisted default audience size (Task 11).
 * Read/written by `AudienceSizeSlider` - kept here (not inline in the
 * component) so the contract is testable without React.
 */
export const AUDIENCE_STORAGE_KEY = 'resonance.defaultAudienceSize'

const LOG_MIN = Math.log(AUDIENCE_MIN)
const LOG_MAX = Math.log(AUDIENCE_MAX)

/**
 * Log-scale mapping from a slider position (0-100) to an audience size
 * (`AUDIENCE_MIN`..`AUDIENCE_MAX`), snapped to 2 significant digits so the
 * live label reads as a round number ("14,000" not "14,142"). Exact at both
 * ends (the 0/100 branches sidestep `Math.exp(Math.log(x))` floating-point
 * drift); monotonic non-decreasing everywhere in between - 2-sig-digit
 * rounding of a strictly increasing exponential curve never decreases.
 */
export function audienceSliderScale(position: number): number {
  const clamped = Math.min(100, Math.max(0, position))
  if (clamped <= 0) return AUDIENCE_MIN
  if (clamped >= 100) return AUDIENCE_MAX
  const value = Math.exp(LOG_MIN + (clamped / 100) * (LOG_MAX - LOG_MIN))
  return Number(value.toPrecision(2))
}

/**
 * Inverse lookup: the integer slider position (0-100) whose
 * `audienceSliderScale` output is closest to a given audience size. Used to
 * rehydrate the slider's position from a persisted `AUDIENCE_STORAGE_KEY`
 * value on mount. Not analytically invertible once 2-significant-digit
 * snapping is applied (several positions can snap to the same value), so
 * this scans the 101 integer positions directly - cheap and exact for a
 * UI-scale problem.
 */
export function nearestSliderPosition(audienceSize: number): number {
  let bestPosition = 0
  let bestDiff = Infinity
  for (let position = 0; position <= 100; position++) {
    const diff = Math.abs(audienceSliderScale(position) - audienceSize)
    if (diff < bestDiff) {
      bestDiff = diff
      bestPosition = position
    }
  }
  return bestPosition
}

/**
 * Client-side mirror of the server's cell-cap guard (`parseRunRequest` in
 * `../domain/payload`, which throws a custom zod issue when `creatives.length
 * * frames.length * audienceSize > CELL_CAP`). Lets `RunComposer` warn and
 * disable submit *before* a doomed POST round-trip, using the exact same
 * formula the server enforces - ordinary usage reaches it easily (e.g. 4
 * creatives x 3 frames x 2,000,000 audience = 24,000,000 > 20,000,000).
 */
export function exceedsCellCap(creativesCount: number, framesCount: number, audienceSize: number): boolean {
  return creativesCount * framesCount * audienceSize > CELL_CAP
}
