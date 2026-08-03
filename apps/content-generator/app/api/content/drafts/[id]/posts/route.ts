import { NextRequest, NextResponse } from "next/server";
import { listPostsForDraft, retryPost } from "@/products/content-generator/publishing/post-repository";
import { publishingDb } from "../../../_publishing/db";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const pool = await publishingDb(request.headers);
    const posts = await listPostsForDraft(pool, id);
    return NextResponse.json({ posts });
  } catch (error) {
    console.error("Error listing posts for draft:", error);
    return NextResponse.json({ error: "Failed to list posts" }, { status: 500 });
  }
}

/** Retry a failed post belonging to this draft: { postId }. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const postId = body?.postId as unknown;
    if (typeof postId !== "string" || postId.length === 0) {
      return NextResponse.json({ error: "A post id is required" }, { status: 400 });
    }

    const pool = await publishingDb(request.headers);
    const posts = await listPostsForDraft(pool, id);
    if (!posts.some((post) => post.id === postId)) {
      return NextResponse.json({ error: "Post not found for this draft" }, { status: 404 });
    }

    const retried = await retryPost(pool, postId);
    if (!retried) {
      return NextResponse.json(
        { error: "Only failed or cancelled posts can be retried" },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error retrying post:", error);
    return NextResponse.json({ error: "Failed to retry the post" }, { status: 500 });
  }
}
