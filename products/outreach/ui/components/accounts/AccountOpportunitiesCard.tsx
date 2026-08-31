import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Lightbulb,
  Package,
  PauseCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccountOpportunityCoverageResult } from "../../../domain/account-opportunity";
import { safeExternalUrl } from "../../safe-external-url";

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function MatchList({
  kind,
  matches,
  threshold,
}: {
  kind: "solution" | "content";
  matches: Array<{
    id: string;
    label: string;
    detail: string;
    score: number;
    href?: string;
  }>;
  threshold?: number;
}) {
  const Icon = kind === "solution" ? Package : FileText;
  const covered = threshold != null && matches.some((match) => match.score >= threshold);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" />{kind === "solution" ? "Catalogue" : "Content"}
        </p>
        <span className="text-xs text-muted-foreground">
          {threshold == null ? "Not calculated" : covered ? "Covered" : `Gap · below ${threshold}%`}
        </span>
      </div>
      {matches.length > 0 ? (
        <ul className="space-y-1.5">
          {matches.map((match) => (
            <li className="flex items-center justify-between gap-3 text-sm" key={match.id}>
              <div className="min-w-0">
                {safeExternalUrl(match.href) ? (
                  <a
                    className="inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
                    href={safeExternalUrl(match.href)!}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <span className="truncate">{match.label}</span><ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : <p className="truncate font-medium">{match.label}</p>}
                <p className="capitalize text-xs text-muted-foreground">{label(match.detail)}</p>
              </div>
              <span className="shrink-0 font-medium tabular-nums">{match.score}%</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No current match.</p>
      )}
    </div>
  );
}

export function AccountOpportunitiesCard({
  result,
}: {
  result: AccountOpportunityCoverageResult;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Lightbulb className="size-4" />
          </span>
          <div>
            <CardTitle>Opportunity angles</CardTitle>
            <CardDescription>
              Account-level angles generated from completed research. Catalogue and content coverage are calculated from current graph embeddings.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {result.opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No opportunity angles yet. Run account research to generate them.
          </p>
        ) : (
          <div className="divide-y">
            {result.opportunities.map((opportunity) => {
              const blockers = opportunity.coverage
                ? [
                    opportunity.coverage.solutionGap ? "solution" : null,
                    opportunity.coverage.contentGap ? "content" : null,
                  ].filter((item): item is string => Boolean(item))
                : [];
              const ready = opportunity.coverage?.touchReady ?? false;
              const coverageLabel = opportunity.coverage == null
                ? "Coverage unavailable"
                : ready
                  ? "Touch ready"
                  : blockers.length > 0
                    ? `Blocked · ${blockers.join(" + ")}`
                    : "Account not eligible";
              return (
                <article className="space-y-4 py-5 first:pt-0 last:pb-0" key={opportunity.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Opportunity angle</p>
                      <p className="text-sm leading-6">{opportunity.angle}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Badge variant="outline">
                        Evidence {Math.round(opportunity.evidenceConfidence * 100)}%
                      </Badge>
                      <Badge variant={ready ? "default" : "secondary"}>
                        {ready ? <CheckCircle2 className="size-3" /> : <PauseCircle className="size-3" />}
                        {coverageLabel}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-5 rounded-lg border bg-muted/10 p-3 md:grid-cols-2">
                    <MatchList
                      kind="solution"
                      threshold={opportunity.coverage ? result.thresholds.solution : undefined}
                      matches={opportunity.solutionMatches.map((match) => ({
                        id: match.catalogItemId,
                        label: match.name,
                        detail: match.kind,
                        score: match.score,
                      }))}
                    />
                    <MatchList
                      kind="content"
                      threshold={opportunity.coverage ? result.thresholds.content : undefined}
                      matches={opportunity.contentMatches.map((match) => ({
                        id: match.contentId,
                        label: match.title,
                        detail: match.type,
                        href: match.publishedUrl,
                        score: match.score,
                      }))}
                    />
                  </div>

                  {opportunity.evidence.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {opportunity.evidence
                        .map((url) => safeExternalUrl(url))
                        .filter((url): url is string => Boolean(url))
                        .slice(0, 4)
                        .map((url) => (
                        <a
                          className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                          href={url}
                          key={url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Evidence source
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {result.calculationStatus === "unavailable" ? (
          <p className="mt-4 text-xs text-muted-foreground">{result.unavailableReason}</p>
        ) : !result.accountEligible ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Coverage can be complete while touch remains paused because the account does not currently pass the ICP gate.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
