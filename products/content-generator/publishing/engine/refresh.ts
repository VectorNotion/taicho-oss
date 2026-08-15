import type { Pool } from "pg";
import {
  createLogger,
  observeOperation,
} from "@content-automation/observability";
import { listChannelsNeedingRefresh, updateChannelTokens } from "../channel-repository";
import { listDestinations } from "../registry";

export const DEFAULT_REFRESH_SKEW_SECONDS = 600;
const log = createLogger("publishing.refresh");

/**
 * The refresh heartbeat, ported from Relay: proactively renew any refreshable
 * channel whose token is missing or expires within the skew window, so a
 * scheduled post never fires on a dead token. One channel failing never breaks
 * the pass.
 */
export async function runRefreshPass(
  pool: Pool,
  { skewSeconds = DEFAULT_REFRESH_SKEW_SECONDS }: { skewSeconds?: number } = {},
): Promise<{ refreshed: number; failed: number }> {
  const refreshable = listDestinations().filter((a) => a.refreshable && a.refresh);
  const byDestination = new Map(refreshable.map((a) => [a.destination, a]));
  const due = await listChannelsNeedingRefresh(pool, [...byDestination.keys()], skewSeconds);

  let refreshed = 0;
  let failed = 0;
  for (const channel of due) {
    const adapter = byDestination.get(channel.destination);
    if (!adapter?.refresh) continue;
    try {
      await observeOperation(
        "publishing.channel.refresh",
        {
          organizationId: channel.orgId ?? undefined,
          actorType: "system",
          jobId: channel.id,
          attributes: {
            "publishing.channel.id": channel.id,
            "publishing.destination": channel.destination,
          },
          workflow: {
            name: "publishing.channel.refresh",
            input: {
              channelId: channel.id,
              destination: channel.destination,
              expiresAt: channel.tokenExpiry,
            },
            processOutput: () => ({ refreshed: true }),
          },
        },
        async () => {
          const result = await adapter.refresh!(channel);
          await updateChannelTokens(pool, channel.id, {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
          });
        },
      );
      refreshed += 1;
    } catch (err) {
      failed += 1;
      log.error("publishing.channel.refresh_failed", err, {
        channel_id: channel.id,
        destination: channel.destination,
      });
    }
  }
  return { refreshed, failed };
}
