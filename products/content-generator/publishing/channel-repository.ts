import type { Pool } from "pg";
import {
  channelsInPublishing as channelsTable,
  databaseFor,
} from "@content-automation/database";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { ChannelRecord, CredentialKind } from "./types";

function rowToChannel(row: Record<string, unknown>): ChannelRecord {
  return {
    id: row.id as string,
    destination: row.destination as string,
    name: row.name as string,
    credentialKind: row.credential_kind as CredentialKind,
    credentials: (row.credentials ?? {}) as Record<string, string>,
    tokenExpiry: row.token_expiry ? new Date(row.token_expiry as string | Date) : null,
    extra: (row.extra ?? {}) as Record<string, unknown>,
    orgId: (row.org_id as string | null) ?? null,
    disabled: Boolean(row.disabled),
  };
}

export async function upsertChannel(
  pool: Pool,
  input: {
    id: string;
    destination: string;
    name: string;
    credentialKind: CredentialKind;
    credentials: Record<string, string>;
    tokenExpiry?: Date | null;
    extra?: Record<string, unknown>;
    orgId?: string | null;
  },
): Promise<ChannelRecord> {
  const [row] = await databaseFor(pool)
    .insert(channelsTable)
    .values({
      id: input.id,
      destination: input.destination,
      name: input.name,
      credential_kind: input.credentialKind,
      credentials: input.credentials,
      token_expiry: input.tokenExpiry?.toISOString() ?? null,
      extra: input.extra ?? {},
      ...(input.orgId ? { org_id: input.orgId } : {}),
    })
    .onConflictDoUpdate({
      target: [channelsTable.org_id, channelsTable.id],
      set: {
        name: input.name,
        credentials: input.credentials,
        token_expiry: input.tokenExpiry?.toISOString() ?? null,
        extra: input.extra ?? {},
        disabled: false,
        updated_at: new Date().toISOString(),
      },
    })
    .returning();
  return rowToChannel(row);
}

export async function listChannels(pool: Pool): Promise<ChannelRecord[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.disabled, false))
    .orderBy(asc(channelsTable.destination), asc(channelsTable.name));
  return rows.map(rowToChannel);
}

export async function getChannel(pool: Pool, id: string): Promise<ChannelRecord | null> {
  const [row] = await databaseFor(pool)
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, id))
    .limit(1);
  return row ? rowToChannel(row) : null;
}

export async function updateChannelTokens(
  pool: Pool,
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt: Date | null },
): Promise<void> {
  const credentials = tokens.refreshToken
    ? { access_token: tokens.accessToken, refresh_token: tokens.refreshToken }
    : { access_token: tokens.accessToken };
  await databaseFor(pool)
    .update(channelsTable)
    .set({
      credentials: sql`${channelsTable.credentials} || ${credentials}`,
      token_expiry: tokens.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .where(eq(channelsTable.id, id));
}

export async function disconnectChannel(pool: Pool, id: string): Promise<boolean> {
  const rows = await databaseFor(pool)
    .update(channelsTable)
    .set({ disabled: true, updated_at: new Date().toISOString() })
    .where(eq(channelsTable.id, id))
    .returning({ id: channelsTable.id });
  return rows.length > 0;
}

/** Channels whose destination is refreshable and whose token is missing or expires within skewSeconds. */
export async function listChannelsNeedingRefresh(
  pool: Pool,
  refreshableDestinations: string[],
  skewSeconds: number,
): Promise<ChannelRecord[]> {
  if (refreshableDestinations.length === 0) return [];
  const cutoff = new Date(Date.now() + skewSeconds * 1_000).toISOString();
  const rows = await databaseFor(pool)
    .select()
    .from(channelsTable)
    .where(and(
      eq(channelsTable.disabled, false),
      inArray(channelsTable.destination, refreshableDestinations),
      or(isNull(channelsTable.token_expiry), lte(channelsTable.token_expiry, cutoff)),
    ));
  return rows.map(rowToChannel);
}
