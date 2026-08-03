"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContentViews } from "./content-views";
import { NurtureViews } from "./nurture-views";

type StatsTab = "content" | "nurture";

export default function StatsPage() {
  const [tab, setTab] = useState<StatsTab>("content");

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        title="Stats"
        description="The product's analytics views, grounded in its real data shapes — every chart names the fields it aggregates, and every section states what the data can't honestly support yet."
      />

      <Tabs onValueChange={(value) => setTab(value as StatsTab)} value={tab}>
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="nurture">Pipeline &amp; nurture</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "content" && <ContentViews />}
      {tab === "nurture" && <NurtureViews />}
    </div>
  );
}
