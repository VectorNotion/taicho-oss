/**
 * One-time migration: copy connected channels from Relay's SQLite into the
 * publishing schema. Run on the box that has the Relay database:
 *
 *   RELAY_SQLITE=/root/relay/data/relay.sqlite pnpm --filter @content-automation/content-generator exec tsx scripts/migrate-relay-channels.ts
 *
 * Idempotent: re-running upserts the same channel ids.
 */
// @ts-expect-error node:sqlite ships with Node >=22.5 but this @types/node predates its typings
import { DatabaseSync } from "node:sqlite";
import { upsertChannel } from "../publishing/channel-repository";
import { getPublishingPool } from "../publishing/pool";
import { ensurePublishingSchema } from "../publishing/schema";
import type { CredentialKind } from "../publishing/types";

async function main() {
  const sqlitePath = process.env.RELAY_SQLITE ?? "relay.sqlite";
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const pool = getPublishingPool();
  await ensurePublishingSchema(pool);

  interface RelayChannelRow {
    id: string;
    platform: string;
    name: string;
    access_token: string;
    refresh_token: string | null;
    token_expiry: number;
    extra: string;
    disabled: number;
  }

  const rows = db.prepare("SELECT * FROM channels WHERE disabled = 0").all() as unknown as RelayChannelRow[];
  let migrated = 0;

  for (const row of rows) {
    const extra = JSON.parse(row.extra || "{}") as Record<string, unknown>;
    const credentialKind: CredentialKind = row.platform === "x" ? "oauth1" : "oauth2";
    const credentials: Record<string, string> = { access_token: row.access_token };
    if (row.refresh_token) credentials.refresh_token = row.refresh_token;
    if (row.platform === "x" && typeof extra.token_secret === "string") {
      credentials.token_secret = extra.token_secret;
      delete extra.token_secret;
    }
    await upsertChannel(pool, {
      id: row.id,
      destination: row.platform,
      name: row.name,
      credentialKind,
      credentials,
      tokenExpiry: row.token_expiry > 0 ? new Date(row.token_expiry * 1000) : null,
      extra,
    });
    migrated += 1;
    console.log(`migrated ${row.platform}/${row.name} (${row.id})`);
  }

  await pool.end();
  db.close();
  console.log(`Done: ${migrated} channel(s) migrated from ${sqlitePath}`);
}

main().catch((err) => {
  console.error("[migrate-relay-channels] fatal", err);
  process.exit(1);
});
