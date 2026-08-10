"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  FileText,
  Flag,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  InsightClaim,
  ProspectEvidence,
  ProspectInsightSnapshot,
  ProspectInsightSourceRef,
  ProspectInsightSourceTab,
  ProspectIntelligenceWorkspace,
  ProspectMeeting,
  ProspectSemanticSearchResponse,
  ProspectTimelineItem,
} from "../../../domain/prospect-intelligence";
import {
  groupTranscriptEvidence,
  transcriptSpeakerLabel,
  type TranscriptGroup,
} from "./transcript-groups";

type ProspectTab = "overview" | ProspectInsightSourceTab | "timeline" | "insights";
const PROSPECT_TABS = new Set<ProspectTab>(["overview", "timeline", "transcription", "notes", "insights"]);

type ProspectIntelligenceTabsProps = {
  prospectId: string;
  prospectName: string;
  notesVersion: string;
  overview: ReactNode;
  notes: ReactNode;
};

function dateTime(value: string | null) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function meetingHost(value: string | null) {
  if (!value) return "Desktop capture";
  try {
    return new URL(value).hostname;
  } catch {
    return "Meeting";
  }
}

function statusLabel(status: ProspectMeeting["status"]) {
  return status.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function statusVariant(status: ProspectMeeting["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "in_meeting") return "secondary";
  return "outline";
}

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The request failed.");
  return data;
}

function EmptyState({ icon: Icon, children }: { icon: typeof FileText; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center text-muted-foreground">
      <Icon className="h-8 w-8" />
      <p className="max-w-md text-sm">{children}</p>
    </div>
  );
}

function TranscriptRow({ item, speakerLabel }: { item: ProspectEvidence; speakerLabel: string }) {
  const seconds = item.offsetMs == null ? null : Math.floor(item.offsetMs / 1000);
  const offset = seconds == null
    ? null
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div
      className="grid scroll-mt-24 gap-1 border-b py-4 transition-colors last:border-b-0 target:rounded-md target:bg-primary/10 target:px-3 target:ring-2 target:ring-primary/30 sm:grid-cols-[180px_1fr] sm:gap-5"
      id={`evidence-${item.id}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" />
        <span className="truncate font-medium text-foreground">{speakerLabel}</span>
        {offset && <span>{offset}</span>}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
    </div>
  );
}

function durationLabel(durationMs: number | null) {
  if (durationMs == null) return null;
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function transcriptGroupTitle(group: TranscriptGroup) {
  if (group.kind === "meeting") return meetingHost(group.meeting?.meetingUrl ?? null);
  if (group.kind === "desktop_recording") return "Desktop recording";
  return "Imported transcript";
}

function transcriptGroupSource(group: TranscriptGroup) {
  if (group.kind === "desktop_recording") return "Microphone + system audio";
  if (group.kind !== "meeting") return "External transcript";
  return group.meeting?.provider === "recall" ? "Recall meeting" : "Attendee meeting";
}

function TranscriptGroupSection({ group, prospectName }: { group: TranscriptGroup; prospectName: string }) {
  const duration = durationLabel(group.durationMs);
  const source = transcriptGroupSource(group);
  const reference = group.externalRecordingId ?? group.meeting?.id ?? null;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" data-transcript-group={group.key}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" />{transcriptGroupTitle(group)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {dateTime(group.startedAt)} · {source}{duration ? ` · ${duration}` : ""}{reference ? ` · ${reference.slice(0, 8)}` : ""}
          </p>
        </div>
        <Badge variant="secondary">{group.utterances.length} utterance{group.utterances.length === 1 ? "" : "s"}</Badge>
      </header>
      <div className="px-4">
        {group.utterances.map((item) => (
          <TranscriptRow
            item={item}
            key={item.id}
            speakerLabel={transcriptSpeakerLabel(item, group, prospectName)}
          />
        ))}
      </div>
    </section>
  );
}

function sourceHref(source: ProspectInsightSourceRef) {
  return `?tab=${source.target.tab}#${encodeURIComponent(source.target.anchorId)}`;
}

function sourceLinkLabel(source: ProspectInsightSourceRef) {
  if (source.type !== "transcript_utterance" || source.target.offsetMs == null) return source.label;
  const seconds = Math.floor(source.target.offsetMs / 1000);
  return `${source.label} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function SourceLink({
  source,
  onNavigate,
}: {
  source: ProspectInsightSourceRef;
  onNavigate: (source: ProspectInsightSourceRef, event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      className="inline-flex max-w-full items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={sourceHref(source)}
      onClick={(event) => onNavigate(source, event)}
      title={`Open ${source.type.replaceAll("_", " ")} source ${source.id}`}
    >
      <Link2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{sourceLinkLabel(source)}</span>
    </a>
  );
}

function ClaimList({
  title,
  claims,
  sources,
  onNavigate,
}: {
  title: string;
  claims: InsightClaim[];
  sources: Map<string, ProspectInsightSourceRef>;
  onNavigate: (source: ProspectInsightSourceRef, event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  if (claims.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
      <ul className="space-y-2">
        {claims.map((claim, index) => (
          <li className="rounded-lg border-l-2 border-l-primary/50 bg-muted/30 px-3 py-2.5 text-sm" key={`${title}-${index}`}>
            <p className="leading-6">{claim.text}</p>
            {(claim.owner || claim.dueDate) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {[claim.owner && `Owner: ${claim.owner}`, claim.dueDate && `Due: ${claim.dueDate}`].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {claim.sourceIds.map((sourceId) => {
                const source = sources.get(sourceId);
                return source
                  ? <SourceLink key={sourceId} onNavigate={onNavigate} source={source} />
                  : <span className="text-destructive" key={sourceId}>Missing source · {sourceId}</span>;
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TIMELINE_KIND = {
  discovered: { icon: CircleDot, label: "Discovered", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  reaction: { icon: ThumbsUp, label: "Reaction", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  comment: { icon: MessageSquare, label: "Comment", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  connection_request: { icon: UserPlus, label: "Connect sent", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  connection_accepted: { icon: UserCheck, label: "Connected", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  message_sent: { icon: Mail, label: "Message sent", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  reply_received: { icon: MessageSquare, label: "Reply", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  meeting: { icon: CalendarDays, label: "Meeting", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  note: { icon: NotebookPen, label: "Note", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  update: { icon: RefreshCw, label: "Update", tone: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  status_change: { icon: Flag, label: "Status", tone: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  research: { icon: Search, label: "Research", tone: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  other: { icon: CircleDot, label: "Activity", tone: "bg-muted text-muted-foreground" },
} as const;

function RelationshipTimeline({
  items,
  sources,
  onNavigate,
}: {
  items: ProspectTimelineItem[];
  sources: Map<string, ProspectInsightSourceRef>;
  onNavigate: (source: ProspectInsightSourceRef, event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold tracking-tight"><CalendarDays className="h-4 w-4 text-primary" />Relationship timeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">Insight-owned history inferred from every recorded touchpoint, with links to its evidence.</p>
        </div>
        <Badge variant="outline">{items.length} moments</Badge>
      </div>
      <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-border sm:before:left-[121px]">
        {items.map((item, index) => {
          const config = TIMELINE_KIND[item.kind];
          const Icon = config.icon;
          return (
            <li className="relative grid gap-3 pb-6 last:pb-0 sm:grid-cols-[88px_36px_1fr] sm:gap-4" key={`${item.occurredAt ?? "unknown"}-${item.title}-${index}`}>
              <time className="hidden pt-2 text-right text-[11px] font-medium tabular-nums text-muted-foreground sm:block" dateTime={item.occurredAt ?? undefined}>
                {item.occurredAt ? new Date(item.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown"}
              </time>
              <span className={`relative z-10 grid h-9 w-9 place-items-center rounded-full ring-4 ring-card ${config.tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 rounded-xl border bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{config.label}</span>
                  {item.significance === "milestone" && <Badge className="h-5 gap-1 px-1.5 text-[10px]" variant="secondary"><CheckCircle2 className="h-3 w-3" />Milestone</Badge>}
                  {item.occurredAt && <time className="text-[11px] text-muted-foreground sm:hidden" dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time>}
                </div>
                <h4 className="mt-1 text-sm font-semibold">{item.title}</h4>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {item.sourceIds.map((sourceId) => {
                    const source = sources.get(sourceId);
                    return source
                      ? <SourceLink key={sourceId} onNavigate={onNavigate} source={source} />
                      : <span className="text-destructive" key={sourceId}>Missing source · {sourceId}</span>;
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OpportunitySnapshot({ insight }: { insight: ProspectInsightSnapshot }) {
  const nextStep = insight.content.nextSteps[0];
  return (
    <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/15 via-card to-violet-500/10 shadow-md">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Current opportunity assessment</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{insight.summary}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="h-7 px-3 capitalize">Stage · {insight.content.relationshipStatus.replaceAll("_", " ")}</Badge>
            <Badge className="h-7 px-3 capitalize" variant="secondary">Sentiment · {insight.content.sentiment}</Badge>
          </div>
        </div>
        <div className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended next move</p>
            <p className="mt-1 text-sm font-medium leading-6">{nextStep?.text ?? "Capture the next touchpoint to keep the opportunity moving."}</p>
          </div>
          <p className="text-xs text-muted-foreground">Insight revision {insight.revision} · {insight.evidenceCount} sources · {dateTime(insight.createdAt)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightCard({
  insight,
  current,
  onNavigate,
}: {
  insight: ProspectInsightSnapshot;
  current?: boolean;
  onNavigate: (source: ProspectInsightSourceRef, event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  const sources = new Map(insight.sourceRefs.map((source) => [source.id, source]));
  return (
    <Card className={current ? "overflow-hidden border-primary/20 shadow-md" : "overflow-hidden"}>
      <CardHeader className={current ? "border-b bg-gradient-to-br from-primary/10 via-card to-violet-500/5 py-6" : "border-b bg-muted/20"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              Insight revision {insight.revision}
              {current && <Badge>Current</Badge>}
            </CardTitle>
            <CardDescription>
              {dateTime(insight.createdAt)} · {insight.evidenceCount} sources · {insight.modelProvider}/{insight.modelName}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{insight.content.relationshipStatus.replaceAll("_", " ")}</Badge>
            <Badge variant="secondary">{insight.content.sentiment}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-4">
          <p className="text-base font-medium leading-7 tracking-tight">{insight.summary}</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <ClaimList title="Key points" claims={insight.content.keyPoints} onNavigate={onNavigate} sources={sources} />
          <ClaimList title="Pain points" claims={insight.content.painPoints} onNavigate={onNavigate} sources={sources} />
          <ClaimList title="Objections" claims={insight.content.objections} onNavigate={onNavigate} sources={sources} />
          <ClaimList title="Commitments" claims={insight.content.commitments} onNavigate={onNavigate} sources={sources} />
          <ClaimList title="Next steps" claims={insight.content.nextSteps} onNavigate={onNavigate} sources={sources} />
          <ClaimList title="Open questions" claims={insight.content.openQuestions} onNavigate={onNavigate} sources={sources} />
        </div>
        <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">Evidence and provenance</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>Generated because: {insight.generatedReason.replaceAll("_", " ")}</p>
            {insight.sourceRefs.map((source) => (
              <div className="flex items-center justify-between gap-3" key={source.id}>
                <SourceLink onNavigate={onNavigate} source={source} />
                <code className="shrink-0 text-[10px]">{source.id}</code>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export function ProspectIntelligenceTabs({ prospectId, prospectName, notesVersion, overview, notes }: ProspectIntelligenceTabsProps) {
  const [activeTab, setActiveTab] = useState<ProspectTab>("overview");
  const [workspace, setWorkspace] = useState<ProspectIntelligenceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [manualUpdate, setManualUpdate] = useState("");
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<ProspectSemanticSearchResponse | null>(null);
  const [searchingProspect, setSearchingProspect] = useState(false);

  const scrollToLocationSource = useCallback(() => {
    if (!window.location.hash) return;
    let anchorId = window.location.hash.slice(1);
    try {
      anchorId = decodeURIComponent(anchorId);
    } catch {
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }, []);

  const syncTabFromLocation = useCallback(() => {
    const requested = new URL(window.location.href).searchParams.get("tab");
    if (requested && PROSPECT_TABS.has(requested as ProspectTab)) setActiveTab(requested as ProspectTab);
    scrollToLocationSource();
  }, [scrollToLocationSource]);

  useEffect(() => {
    syncTabFromLocation();
    window.addEventListener("popstate", syncTabFromLocation);
    window.addEventListener("hashchange", syncTabFromLocation);
    return () => {
      window.removeEventListener("popstate", syncTabFromLocation);
      window.removeEventListener("hashchange", syncTabFromLocation);
    };
  }, [syncTabFromLocation]);

  useEffect(() => {
    scrollToLocationSource();
  }, [activeTab, notesVersion, scrollToLocationSource, workspace]);

  const changeTab = useCallback((value: string) => {
    if (!PROSPECT_TABS.has(value as ProspectTab)) return;
    const tab = value as ProspectTab;
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }, []);

  const navigateToSource = useCallback((
    source: ProspectInsightSourceRef,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setActiveTab(source.target.tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", source.target.tab);
    url.hash = source.target.anchorId;
    window.history.pushState(null, "", url);
    scrollToLocationSource();
  }, [scrollToLocationSource]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/outreach/prospects/${prospectId}/intelligence`, { cache: "no-store" });
    const data = await responseData(response) as unknown as ProspectIntelligenceWorkspace;
    setWorkspace(data);
  }, [prospectId]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load prospect intelligence."))
      .finally(() => setLoading(false));
  }, [notesVersion, refresh]);

  const transcripts = useMemo(
    () => workspace?.evidence.filter((item) => item.kind === "transcript_utterance") ?? [],
    [workspace],
  );
  const transcriptGroups = useMemo(
    () => groupTranscriptEvidence(transcripts, workspace?.meetings ?? []),
    [transcripts, workspace?.meetings],
  );
  const manualUpdates = useMemo(
    () => [...(workspace?.evidence.filter((item) => item.kind === "manual_update") ?? [])].reverse(),
    [workspace],
  );
  const currentInsight = useMemo(
    () => workspace?.insights.find((item) => item.status === "current") ?? workspace?.insights[0] ?? null,
    [workspace],
  );
  const timelineSources = useMemo(
    () => new Map(workspace?.timeline?.sourceRefs.map((source) => [source.id, source]) ?? []),
    [workspace],
  );

  const startMeeting = async () => {
    if (!meetingUrl.trim()) return;
    setStartingMeeting(true);
    try {
      await responseData(await fetch(`/api/outreach/prospects/${prospectId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl }),
      }));
      setMeetingUrl("");
      await refresh();
      toast.success("Taicho is joining the meeting");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the meeting bot.");
    } finally {
      setStartingMeeting(false);
    }
  };

  const addManualUpdate = async () => {
    if (!manualUpdate.trim()) return;
    setSavingUpdate(true);
    try {
      const result = await responseData(await fetch(`/api/outreach/prospects/${prospectId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: manualUpdate }),
      }));
      setManualUpdate("");
      await refresh();
      if (typeof result.warning === "string") toast.warning(result.warning);
      else toast.success("Update saved and insights refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this update.");
    } finally {
      setSavingUpdate(false);
    }
  };

  const regenerateInsights = async () => {
    setRefreshingInsights(true);
    try {
      await responseData(await fetch(`/api/outreach/prospects/${prospectId}/insights`, { method: "POST" }));
      await refresh();
      toast.success("Insights refreshed from all current evidence");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh insights.");
    } finally {
      setRefreshingInsights(false);
    }
  };

  const searchProspect = async (requestedQuery = semanticQuery) => {
    const query = requestedQuery.trim();
    if (query.length < 2) return;
    setSemanticQuery(query);
    setSearchingProspect(true);
    try {
      const result = await responseData(await fetch(`/api/outreach/prospects/${prospectId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 6 }),
      })) as unknown as ProspectSemanticSearchResponse;
      setSemanticResults(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not search this prospect.");
    } finally {
      setSearchingProspect(false);
    }
  };

  return (
    <Tabs className="gap-5" onValueChange={changeTab} value={activeTab}>
      <div className="overflow-x-auto rounded-2xl border bg-gradient-to-r from-muted/60 via-card to-primary/5 p-2 shadow-sm">
        <TabsList className="grid h-12 w-full min-w-[760px] grid-cols-5 bg-transparent p-0">
          <TabsTrigger className="h-10 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm" value="overview"><UserRound />Overview</TabsTrigger>
          <TabsTrigger className="h-10 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm" value="timeline"><CalendarDays />Timeline{workspace?.timeline?.events.length ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">{workspace.timeline.events.length}</span> : null}</TabsTrigger>
          <TabsTrigger className="h-10 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm" value="transcription"><FileText />Transcription{transcripts.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{transcripts.length}</span>}</TabsTrigger>
          <TabsTrigger className="h-10 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm" value="notes"><NotebookPen />Notes{manualUpdates.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{manualUpdates.length}</span>}</TabsTrigger>
          <TabsTrigger className="h-10 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm" value="insights"><Sparkles />Insights{workspace?.insights.length ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">{workspace.insights.length}</span> : null}</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview">
        <div className="scroll-mt-24 rounded-xl target:ring-2 target:ring-primary/30" id={`prospect-created-${prospectId}`}>
          {overview}
        </div>
      </TabsContent>

      <TabsContent value="timeline" className="space-y-4">
        {loading ? (
          <div className="space-y-4"><Skeleton className="h-44 w-full" /><Skeleton className="h-80 w-full" /></div>
        ) : currentInsight && workspace?.timeline ? (
          <>
            <OpportunitySnapshot insight={currentInsight} />
            <RelationshipTimeline
              items={workspace.timeline.events}
              onNavigate={navigateToSource}
              sources={timelineSources}
            />
          </>
        ) : (
          <EmptyState icon={CalendarDays}>No relationship timeline yet. Add the first touchpoint or note, then generate an insight.</EmptyState>
        )}
      </TabsContent>

      <TabsContent value="transcription" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Start a meeting capture</CardTitle>
            <CardDescription>Paste a Zoom, Google Meet, or Microsoft Teams link. Taicho sends a Recall bot now, then attaches the speaker-attributed transcript to this prospect when the meeting ends.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Label htmlFor="prospect-meeting-url">Meeting link</Label>
                <Input
                  id="prospect-meeting-url"
                  onChange={(event) => setMeetingUrl(event.target.value)}
                  placeholder="https://meet.google.com/..."
                  type="url"
                  value={meetingUrl}
                />
              </div>
              <Button className="self-end" disabled={startingMeeting || !meetingUrl.trim() || workspace?.meetingCaptureConfigured === false} onClick={startMeeting}>
                {startingMeeting ? <Loader2 className="animate-spin" /> : <Bot />}
                Start meeting
              </Button>
            </div>
            {workspace?.meetingCaptureConfigured === false && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Recall meeting capture is not configured in this environment yet. Existing transcripts and insights remain available.
              </p>
            )}
          </CardContent>
        </Card>

        {loading ? <Skeleton className="h-44 w-full" /> : workspace?.meetings.length ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Meeting captures</CardTitle><CardDescription>Provider state and ingestion history for this prospect.</CardDescription></div>
              <Button aria-label="Refresh meeting state" onClick={() => void refresh()} size="icon" variant="ghost"><RefreshCw /></Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {workspace.meetings.map((meeting) => (
                <div className="rounded-lg border p-4" key={meeting.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">{meetingHost(meeting.meetingUrl)}</span></div>
                    <Badge variant={statusVariant(meeting.status)}>{statusLabel(meeting.status)}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Created {dateTime(meeting.createdAt)} · {meeting.provider === "recall" ? "Recall" : "Attendee"} bot {meeting.providerBotId ?? "pending"}</p>
                  {meeting.statusDetail && <p className="mt-1 text-xs text-muted-foreground">{meeting.statusDetail}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle>Transcripts</CardTitle><CardDescription>Each meeting and desktop recording is kept as a separate, chronologically ordered transcript.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {loading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : transcriptGroups.length ? transcriptGroups.map((group) => <TranscriptGroupSection group={group} key={group.key} prospectName={prospectName} />) : <EmptyState icon={FileText}>No transcript yet. Record a call or start a meeting capture; each transcript will appear in its own section.</EmptyState>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Ingestion audit</CardTitle><CardDescription>Signed provider deliveries are recorded once and linked to their resulting evidence.</CardDescription></CardHeader>
          <CardContent>
            {workspace?.events.length ? (
              <div className="space-y-2">
                {[...workspace.events].reverse().map((event) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs" key={event.id}>
                    <span><Database className="mr-2 inline h-3.5 w-3.5" />{event.trigger}{event.eventType ? ` · ${event.eventType}` : ""}</span>
                    <span className="text-muted-foreground">{dateTime(event.occurredAt ?? event.receivedAt)} · {event.providerDeliveryId}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={ShieldCheck}>No provider deliveries have been received for this prospect.</EmptyState>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notes" className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Add a prospect update</CardTitle><CardDescription>This is durable evidence, not an overwrite. Saving it creates a new insight revision grounded in this update plus every existing note and transcript.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Textarea aria-label="Prospect update" onChange={(event) => setManualUpdate(event.target.value)} placeholder={`What changed with ${prospectName}? Include decisions, corrections, objections, or next steps.`} rows={5} value={manualUpdate} />
            <div className="flex justify-end"><Button disabled={savingUpdate || !manualUpdate.trim()} onClick={addManualUpdate}>{savingUpdate ? <Loader2 className="animate-spin" /> : <Sparkles />}Save & refresh insights</Button></div>
          </CardContent>
        </Card>
        {manualUpdates.length > 0 && (
          <Card>
            <CardHeader><CardTitle>AI evidence updates</CardTitle><CardDescription>Manual additions with explicit provenance.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {manualUpdates.map((item) => <div className="scroll-mt-24 rounded-md border p-3 transition-colors target:bg-primary/10 target:ring-2 target:ring-primary/30" id={`evidence-${item.id}`} key={item.id}><p className="whitespace-pre-wrap text-sm">{item.content}</p><p className="mt-2 text-xs text-muted-foreground"><Clock3 className="mr-1 inline h-3.5 w-3.5" />{dateTime(item.createdAt)} · {item.sourceLabel} · {item.id}</p></div>)}
            </CardContent>
          </Card>
        )}
        {notes}
      </TabsContent>

      <TabsContent value="insights" className="space-y-4">
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-cyan-500/5 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg"><Search className="h-5 w-5 text-primary" />Search the relationship</CardTitle>
                <CardDescription className="mt-1">Ask in plain language. Semantic search ranks this prospect&apos;s transcripts, notes, outreach, and activity, then links you to the original record.</CardDescription>
              </div>
              <Badge className="gap-1" variant="outline"><Database className="h-3 w-3" />FalkorDB vectors</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void searchProspect();
              }}
            >
              <Input
                aria-label="Semantic search across this prospect"
                className="h-11 bg-background/80 shadow-sm"
                disabled={workspace?.semanticSearchConfigured === false || searchingProspect}
                onChange={(event) => setSemanticQuery(event.target.value)}
                placeholder={`What has ${prospectName} said about budget, timing, or next steps?`}
                value={semanticQuery}
              />
              <Button className="h-11 sm:min-w-28" disabled={workspace?.semanticSearchConfigured === false || searchingProspect || semanticQuery.trim().length < 2} type="submit">
                {searchingProspect ? <Loader2 className="animate-spin" /> : <Search />}
                Search
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {["What objections have come up?", "What did they commit to?", "What should happen next?"].map((prompt) => (
                <Button
                  className="h-7 rounded-full px-3 text-xs"
                  disabled={workspace?.semanticSearchConfigured === false || searchingProspect}
                  key={prompt}
                  onClick={() => void searchProspect(prompt)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {prompt}
                </Button>
              ))}
            </div>
            {workspace?.semanticSearchConfigured === false && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Semantic search needs an embedding endpoint in this environment. FalkorDB and the rest of prospect intelligence remain available.
              </p>
            )}
            {semanticResults && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Most relevant evidence</p>
                  <p className="text-xs text-muted-foreground">{semanticResults.indexedCount} source{semanticResults.indexedCount === 1 ? "" : "s"} indexed</p>
                </div>
                {semanticResults.results.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {semanticResults.results.map((result, index) => (
                      <div className="rounded-xl border bg-background/80 p-4 shadow-sm" key={`${result.source.id}-${index}`}>
                        <div className="flex items-start justify-between gap-3">
                          <SourceLink onNavigate={navigateToSource} source={result.source} />
                          <Badge className="shrink-0 tabular-nums" variant="secondary">{Math.max(0, Math.round(result.score * 100))}% match</Badge>
                        </div>
                        <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{result.content}</p>
                        <p className="mt-2 text-[11px] text-muted-foreground">{dateTime(result.source.occurredAt ?? result.source.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={Search}>No semantically related evidence was found for this query.</EmptyState>}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Prospect insights</h2><p className="text-sm text-muted-foreground">Versioned, source-linked interpretation of notes, updates, and transcripts.</p></div>
          <Button disabled={refreshingInsights} onClick={regenerateInsights} variant="outline">{refreshingInsights ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh from evidence</Button>
        </div>
        {loading ? <Skeleton className="h-80 w-full" /> : workspace?.insights.length ? workspace.insights.map((item, index) => <InsightCard current={index === 0 && item.status === "current"} insight={item} key={item.id} onNavigate={navigateToSource} />) : <EmptyState icon={Sparkles}>No insight snapshot yet. Add a note or update, or complete a transcribed meeting, then refresh insights.</EmptyState>}
      </TabsContent>
    </Tabs>
  );
}
