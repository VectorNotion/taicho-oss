import { NextResponse } from "next/server";
import { listChannels } from "@/products/content-generator/publishing/channel-repository";
import { cancelPost, listHistory, listQueue, retryPost } from "@/products/content-generator/publishing/post-repository";
import { getSession } from "@content-automation/platform/data/graph";
import { publishingDb } from "../_publishing/db";

export const runtime = "nodejs";

async function draftTitles(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (d:ContentDraft) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title`,
      { ids },
    );
    return Object.fromEntries(result.records.map((r) => [r.get("id"), r.get("title")]));
  } finally {
    await session.close();
  }
}

export async function GET(request: Request) {
  const pool = await publishingDb(request.headers);
  const [queue, history, channels] = await Promise.all([listQueue(pool), listHistory(pool, 100), listChannels(pool)]);
  const channelNames = Object.fromEntries(channels.map((c) => [c.id, c.name]));
  const ids = [...new Set([...queue, ...history].map((p) => p.draftId).filter((id): id is string => Boolean(id)))];
  const titles = await draftTitles(ids);
  const decorate = (posts: typeof queue) =>
    posts.map((p) => ({
      ...p,
      draftTitle: p.draftId ? (titles[p.draftId] ?? p.draftId) : null,
      channelName: channelNames[p.channelId] ?? p.channelId,
    }));
  return NextResponse.json({ queue: decorate(queue), history: decorate(history) });
}

export async function POST(request: Request) {
  const pool = await publishingDb(request.headers);
  const body = (await request.json()) as { action?: string; postId?: string };
  if (!body.postId || !body.action) {
    return NextResponse.json({ error: "action and postId are required" }, { status: 400 });
  }
  if (body.action === "cancel") {
    const ok = await cancelPost(pool, body.postId);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Only scheduled posts can be cancelled" }, { status: 409 });
  }
  if (body.action === "retry") {
    const ok = await retryPost(pool, body.postId);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Only failed or cancelled posts can be retried" }, { status: 409 });
  }
  return NextResponse.json({ error: `Unknown action '${body.action}'` }, { status: 400 });
}
