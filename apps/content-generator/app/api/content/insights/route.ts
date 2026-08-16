import { NextResponse } from "next/server";
import { getCurrentContentInsightFeed } from "./_feed";

export async function GET() {
  try {
    return NextResponse.json(await getCurrentContentInsightFeed());
  } catch (error) {
    console.error("Error fetching content insights:", error);
    return NextResponse.json({ error: "Failed to fetch content insights" }, { status: 500 });
  }
}
