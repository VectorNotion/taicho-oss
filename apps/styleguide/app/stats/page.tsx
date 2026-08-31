"use client";

import { PageHeader } from "@/components/PageHeader";
import { ContentViews } from "./content-views";

export default function StatsPage() {
  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        title="Stats"
        description="The product's analytics views, grounded in its real data shapes — every chart names the fields it aggregates, and every section states what the data can't honestly support yet."
      />

      <ContentViews />
    </div>
  );
}
