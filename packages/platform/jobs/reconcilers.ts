/**
 * Registry of out-of-process job reconcilers.
 *
 * A resonance run lives on Modal, and its job row only advances when something
 * on this side polls Modal for the result. `handleGetRun` does that for a user
 * who is actively watching; nobody does it for a user who closed the tab.
 *
 * Rather than have `packages/platform` import `packages/resonance` (which
 * depends on platform — a workspace dependency cycle), the sweep side is
 * inverted: platform owns this registry and runs whatever is registered, and
 * the app registers the resonance sweeper once per server process from
 * `apps/unified/instrumentation.ts`.
 *
 * Reconcilers must be individually safe to run concurrently with a user's own
 * poll of the same job; they are also intentionally best-effort — a failing
 * reconciler is logged and never blocks the request that triggered it.
 */
import { createLogger } from '@content-automation/observability';

const log = createLogger('platform.jobs.reconcilers');

export type JobReconciler = () => Promise<unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __platformJobReconcilers: Map<string, JobReconciler> | undefined;
}

function registry(): Map<string, JobReconciler> {
  return (globalThis.__platformJobReconcilers ??= new Map<string, JobReconciler>());
}

/** Idempotent: registering the same name twice replaces the previous entry rather than running it twice. */
export function registerJobReconciler(name: string, reconciler: JobReconciler): void {
  registry().set(name, reconciler);
}

/** Test/teardown helper. */
export function clearJobReconcilers(): void {
  registry().clear();
  globalThis.__platformJobReconcilerPass = null;
}

export function registeredJobReconcilerNames(): string[] {
  return [...registry().keys()];
}

declare global {
  // eslint-disable-next-line no-var
  var __platformJobReconcilerPass: Promise<void> | null | undefined;
}

/**
 * Runs every registered reconciler, isolating failures. Never rejects.
 *
 * NOT re-entrant by design. A reconciler talks to a remote system (Modal), so a
 * pass can take a long time when that system is slow. Since callers now kick
 * this without awaiting it (see `kickJobReconcilers`), an unguarded version
 * would start a fresh overlapping pass on every dispatch, multiplying
 * outbound polls against a backend that is already struggling. While a pass is
 * in flight, further calls join it rather than starting another.
 */
export async function runJobReconcilers(): Promise<void> {
  const inFlight = globalThis.__platformJobReconcilerPass;
  if (inFlight) return inFlight;

  const pass = (async () => {
    for (const [name, reconciler] of registry()) {
      try {
        await reconciler();
      } catch (error) {
        log.error('jobs.reconciler.failed', error, { reconciler: name });
      }
    }
  })().finally(() => { globalThis.__platformJobReconcilerPass = null; });

  globalThis.__platformJobReconcilerPass = pass;
  return pass;
}

/**
 * Fire-and-forget entry point - the one every request path should use.
 *
 * Reconciliation must NEVER sit on the critical path of the work that
 * triggered it. Awaiting a pass (the original shape) meant an unrelated
 * unrelated requests could otherwise wait on up to 25 sequential Modal polls,
 * each through `safeFetchPublicUrl`'s 20 s timeout: with Modal slow or
 * unreachable, that can add roughly 500 seconds of latency.
 * Bounding the batch by COUNT bounds the work, not the time.
 *
 * `runJobReconcilers` never rejects, so there is no unhandled rejection to
 * leak; the re-entrancy guard above keeps detached passes from piling up.
 */
export function kickJobReconcilers(): void {
  void runJobReconcilers();
}
