import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { recordMetricSnapshot } from "@content-automation/platform/metrics/snapshots";
import { getContentDraftById } from "@/products/content-generator/data/content-repository";
import { getPost } from "@/products/content-generator/publishing/post-repository";
import { publishingDb } from "../../../_publishing/db";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_FIELDS = ["impressions", "clicks", "engagements"] as const;

/**
 * Human-as-sensor numeric annotation (spec §6 ingestion ladder, rung 1).
 * [id] is a publishing post id; for manually-published drafts (no publishing
 * rows) the draft is its own single post: postId = draftId = draft.id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await getAuthorizationContext(request.headers);
    if (!context) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const metrics: Record<string, number> = {};
    for (const key of NUMERIC_FIELDS) {
      const value = body?.[key];
      if (value === undefined || value === null || value === "") continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: `${key} must be a non-negative number` },
          { status: 400 },
        );
      }
      metrics[key] = Math.round(parsed);
    }
    if (Object.keys(metrics).length === 0) {
      return NextResponse.json(
        { error: "At least one metric value is required" },
        { status: 400 },
      );
    }

    const pool = await publishingDb(request.headers);
    const post = UUID.test(id) ? await getPost(pool, id) : null;

    let postId: string;
    let draftId: string | undefined;
    if (post) {
      postId = post.id;
      draftId = post.draftId ?? undefined;
    } else {
      const draft = await getContentDraftById(id);
      if (!draft || draft.status !== "published") {
        return NextResponse.json(
          { error: "No published post matches this id" },
          { status: 404 },
        );
      }
      postId = draft.id;
      draftId = draft.id;
    }

    const { id: snapshotId } = await recordMetricSnapshot({
      organizationId: context.organizationId,
      postId,
      draftId,
      source: "human",
      metrics,
    });
    return NextResponse.json({ id: snapshotId }, { status: 201 });
  } catch (error) {
    console.error("Error recording post metrics:", error);
    return NextResponse.json(
      { error: "Failed to record post metrics" },
      { status: 500 },
    );
  }
}
