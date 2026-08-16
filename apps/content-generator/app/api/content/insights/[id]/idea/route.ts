import { NextResponse } from "next/server";
import { contentIdeaInputFromInsight } from "@/products/content-generator/domain/content-insight";
import { findOrCreateContentIdeaFromInsight } from "@/products/content-generator/data/content-repository";
import { getCurrentContentInsightFeed } from "../../_feed";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const feed = await getCurrentContentInsightFeed();
    if (feed.calculationStatus === "unavailable") {
      return NextResponse.json(
        { error: feed.unavailableReasons.join(" ") || "Content insights are unavailable." },
        { status: 503 },
      );
    }
    const insight = feed.insights.find((item) => item.id === id);
    if (!insight) {
      return NextResponse.json({ error: "Content insight not found" }, { status: 404 });
    }
    if (insight.state !== "content_gap") {
      return NextResponse.json(
        { error: "Only an actionable content gap can become a content idea." },
        { status: 409 },
      );
    }
    const idea = await findOrCreateContentIdeaFromInsight(contentIdeaInputFromInsight(insight));
    return NextResponse.json(idea, { status: 201 });
  } catch (error) {
    console.error("Error creating a content idea from an insight:", error);
    return NextResponse.json(
      { error: "Failed to create a content idea from this insight" },
      { status: 500 },
    );
  }
}
