"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, ExternalLink, Target } from "lucide-react";
import type { ProspectResearch } from "@/products/outreach/domain/types";
import { INSIGHT_CATEGORY_CONFIG } from "@/products/outreach/domain/types";
import { ResearchSectionSkeleton } from "./ResearchSkeleton";

interface ResearchSectionProps {
  research: ProspectResearch | null;
  isLoading: boolean;
  /** If true, renders without Card wrapper (for embedding in another Card) */
  inline?: boolean;
}

export function ResearchSection({ research, isLoading, inline = false }: ResearchSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading) {
    if (inline) {
      return <ResearchSectionSkeleton />;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research</CardTitle>
        </CardHeader>
        <CardContent>
          <ResearchSectionSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (!research) {
    if (inline) {
      return (
        <p className="text-sm text-muted-foreground">
          No research yet. Click "Research" to gather insights.
        </p>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Research</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No research yet. Click "Research" to gather insights.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The content that can be rendered inline or in a Card
  const content = (
    <div className="space-y-4">
        {/* Always visible: Highlights */}
        <div className="space-y-3">
          {/* Company Summary - truncated */}
          <p className="text-sm text-muted-foreground line-clamp-2">
            {research.companySummary}
          </p>

          {/* Outreach Angle - prominent */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-primary">Outreach angle</span>
            </div>
            <p className="text-sm">{research.outreachAngle}</p>
          </div>

          {/* Key talking points - just first 2 */}
          {research.talkingPoints && research.talkingPoints.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Key points</p>
              <ul className="space-y-1">
                {research.talkingPoints.slice(0, 2).map((point, index) => (
                  <li key={index} className="text-sm flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span className="line-clamp-1">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Expandable: Full research */}
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span className="text-xs">
                {isExpanded ? "Hide details" : "Show full research"}
              </span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            {/* Full company summary */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Company summary</p>
              <p className="text-sm">{research.companySummary}</p>
            </div>

            {/* All talking points */}
            {research.talkingPoints && research.talkingPoints.length > 2 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">All talking points</p>
                <ul className="space-y-1">
                  {research.talkingPoints.map((point, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Company Insights */}
            {research.companyInsights && research.companyInsights.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Company insights</p>
                <div className="space-y-2">
                  {research.companyInsights.map((insight) => (
                    <div
                      key={insight.id}
                      className="border rounded-lg p-2.5 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-xs">
                          {INSIGHT_CATEGORY_CONFIG[insight.category]?.label ||
                            insight.category}
                        </Badge>
                        {insight.sourceUrl && (
                          <a
                            href={insight.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                          >
                            Source <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <p className="text-sm">{insight.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Competitors */}
            {research.competitors && research.competitors.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Competitors</p>
                <div className="space-y-2">
                  {research.competitors.map((competitor, index) => (
                    <div key={index} className="border rounded-lg p-2.5 space-y-1">
                      <p className="text-sm font-medium">{competitor.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {competitor.relevance}
                      </p>
                      {competitor.aiFocus && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">AI focus:</span>{" "}
                          {competitor.aiFocus}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Updated timestamp */}
            {research.updatedAt && (
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Last updated:{" "}
                {new Date(research.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
    </div>
  );

  // Return inline content or wrapped in Card
  if (inline) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Research</CardTitle>
          <Badge variant="outline" className="text-xs">
            {research.industry}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  );
}
