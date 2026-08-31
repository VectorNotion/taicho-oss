"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import { ReasoningTicker, StreamSection } from "@/components/genui";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Video,
  FileText,
  Hash,
  CheckCircle,
  Circle,
  BookOpen,
  Bot,
  User,
  Search,
  Plus,
  Globe,
  Pause,
  Play,
  Trash2,
  Loader2,
  RefreshCw,
  CircleAlert,
  Pencil,
} from "lucide-react";
import type {
  ResearchSource,
  ResearchItem,
  ResearchSourceType,
  ResearchItemStatus,
} from "@/products/content-generator/domain/research";

const statusConfig: Record<
  ResearchItemStatus,
  { icon: typeof Circle; label: string; variant: "default" | "secondary" | "outline" }
> = {
  unprocessed: {
    icon: Circle,
    label: "Unprocessed",
    variant: "secondary",
  },
  flagged_for_video: {
    icon: Video,
    label: "Video",
    variant: "outline",
  },
  flagged_for_blog: {
    icon: FileText,
    label: "Blog",
    variant: "outline",
  },
  flagged_for_tweet: {
    icon: Hash,
    label: "Tweet",
    variant: "outline",
  },
  processed: {
    icon: CheckCircle,
    label: "Processed",
    variant: "default",
  },
};

const sourceTypeConfig: Record<
  ResearchSourceType,
  { icon: typeof Globe; label: string }
> = {
  website: { icon: Globe, label: "Website" },
  search_term: { icon: Search, label: "Search term" },
};

type ResearchRunPartial = {
  items?: Array<{
    title?: string;
    content?: string;
    tags?: string[];
    priority?: "low" | "medium" | "high";
  }>;
};

type ResearchRunFinal = {
  itemsCreated: number;
  itemsDeduped: number;
  sourcesSearched: number;
  creditsUsed: number;
};

function isHttpWebsiteUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function researchRunErrorMessage(error: string): string {
  return /failed to fetch|networkerror|stream ended without a terminal event/i.test(error)
    ? "The research stream was interrupted before completion. Check your connection and try again."
    : error;
}

export default function ResearchPage() {
  const [activeTab, setActiveTab] = useState<"content" | "sources">("content");
  // Sources state
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  // Items state
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceStatus, setSourceStatus] = useState<"all" | "active" | "disabled">("all");
  const [sourceType, setSourceType] = useState<"all" | ResearchSourceType>("all");

  // Add Source Dialog state
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<ResearchSourceType>("website");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [addSourceLoading, setAddSourceLoading] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<ResearchSource | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<ResearchItem | null>(null);
  const [editItemTarget, setEditItemTarget] = useState<ResearchItem | null>(null);
  const [editItemTitle, setEditItemTitle] = useState("");
  const [editItemContent, setEditItemContent] = useState("");
  const [editItemPriority, setEditItemPriority] = useState<"low" | "medium" | "high">("medium");
  const [editItemTags, setEditItemTags] = useState("");
  const [editItemNote, setEditItemNote] = useState("");
  const [editItemLoading, setEditItemLoading] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);
  const [runPreconditionError, setRunPreconditionError] = useState<string | null>(null);

  const researchStream = useCapabilityStream<ResearchRunPartial, ResearchRunFinal>({
    api: "/content/research/run",
  });
  const runResearchLoading = researchStream.isStreaming;

  // Fetch sources
  const fetchSources = async () => {
    setSourcesLoading(true);
    try {
      const data = await apiGet<{ items: ResearchSource[] }>("/content/research/sources", { limit: 100 });
      setSources(data.items);
    } catch (error) {
      console.error("Error fetching sources:", error);
      toast.error("Could not load sources. Refresh to try again.");
    } finally {
      setSourcesLoading(false);
    }
  };

  // Fetch items
  const fetchItems = async () => {
    setItemsLoading(true);
    try {
      const data = await apiGet<{ items: ResearchItem[] }>("/content/research/items", { limit: 100 });
      setItems(data.items);
    } catch (error) {
      console.error("Error fetching items:", error);
      toast.error("Could not load research items. Refresh to try again.");
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
    fetchItems();
  }, []);

  // Add source
  const handleAddSource = async () => {
    if (!newSourceName || !newSourceUrl) return;
    if (newSourceType === "website" && !isHttpWebsiteUrl(newSourceUrl)) {
      setAddSourceError("Enter a complete website URL beginning with http:// or https://.");
      return;
    }

    setAddSourceError(null);
    setAddSourceLoading(true);
    try {
      await apiMutate("POST", "/content/research/sources", {
        name: newSourceName,
        type: newSourceType,
        url: newSourceUrl,
        enabled: true,
      });

      toast.success("Source added");
      setAddSourceOpen(false);
      setNewSourceName("");
      setNewSourceType("website");
      setNewSourceUrl("");
      await fetchSources();
    } catch (error) {
      console.error("Error adding source:", error);
      const message = error instanceof ApiError
        ? error.message
        : "Could not add the source. Try again.";
      setAddSourceError(message);
      toast.error(message);
    } finally {
      setAddSourceLoading(false);
    }
  };

  // Toggle source enabled
  const handleToggleSource = async (source: ResearchSource) => {
    try {
      await apiMutate("PATCH", `/content/research/sources/${source.id}`, { enabled: !source.enabled });
      toast.success(source.enabled ? "Source disabled" : "Source enabled");
      if (!source.enabled) setRunPreconditionError(null);
      await fetchSources();
    } catch (error) {
      console.error("Error updating source:", error);
      toast.error("Could not update the source. Try again.");
    }
  };

  // Delete source
  const handleDeleteSource = async () => {
    if (!deleteSourceTarget) return;

    try {
      await apiMutate("DELETE", `/content/research/sources/${deleteSourceTarget.id}`, { confirm: true });
      toast.success("Source removed");
      setDeleteSourceTarget(null);
      fetchSources();
    } catch (error) {
      console.error("Error deleting source:", error);
      toast.error("Could not remove the source. Try again.");
    }
  };

  // Update item status
  const handleUpdateItemStatus = async (
    item: ResearchItem,
    status: ResearchItemStatus
  ) => {
    try {
      await apiMutate("PATCH", `/content/research/items/${item.id}`, { status });
      toast.success("Item updated");
      fetchItems();
    } catch (error) {
      console.error("Error updating item:", error);
      toast.error("Could not update the item. Try again.");
    }
  };

  // Delete item
  const handleDeleteItem = async () => {
    if (!deleteItemTarget) return;

    try {
      await apiMutate("DELETE", `/content/research/items/${deleteItemTarget.id}`, { confirm: true });
      toast.success("Item deleted");
      setDeleteItemTarget(null);
      fetchItems();
    } catch (error) {
      console.error("Error deleting item:", error);
      toast.error("Could not delete the item. Try again.");
    }
  };

  const openEditItem = (item: ResearchItem) => {
    setEditItemTarget(item);
    setEditItemTitle(item.title);
    setEditItemContent(item.content);
    setEditItemPriority(item.priority);
    setEditItemTags(item.tags.join(", "));
    setEditItemNote(item.humanNote ?? "");
    setEditItemError(null);
  };

  const handleEditItem = async () => {
    if (!editItemTarget) return;
    if (!editItemTitle.trim() || !editItemContent.trim()) {
      setEditItemError("Title and finding are required.");
      return;
    }
    setEditItemError(null);
    setEditItemLoading(true);
    try {
      await apiMutate("PATCH", `/content/research/items/${editItemTarget.id}`, {
        title: editItemTitle.trim(),
        content: editItemContent.trim(),
        priority: editItemPriority,
        tags: editItemTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        humanNote: editItemNote.trim(),
      });
      toast.success("Research item saved");
      setEditItemTarget(null);
      await fetchItems();
    } catch (error) {
      console.error("Error editing item:", error);
      const message = error instanceof ApiError
        ? error.message
        : "Could not save the research item. Try again.";
      setEditItemError(message);
      toast.error(message);
    } finally {
      setEditItemLoading(false);
    }
  };

  // Run research
  const handleRunResearch = () => {
    const enabledSources = sources.filter((s) => s.enabled);
    if (enabledSources.length === 0) {
      const message = "No enabled sources. Enable at least one source first.";
      setRunPreconditionError(message);
      toast.error(message);
      return;
    }
    setRunPreconditionError(null);
    researchStream.start({ sourceIds: enabledSources.map((source) => source.id), timeRange: "week" });
  };
  useEffect(() => { if (researchStream.final) void fetchItems(); }, [researchStream.final]);
  useEffect(() => {
    if (researchStream.error) toast.error(researchRunErrorMessage(researchStream.error));
  }, [researchStream.error]);

  const runJobId = (researchStream.dataParts.find((part) => part.type === "data-job")?.data as {
    jobId?: string;
  } | undefined)?.jobId;
  const streamedItems = Object.values(researchStream.partialsById)
    .flatMap((partial) => partial.items ?? [])
    .filter((item) => item.title);

  // Filter items by search
  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );
  const normalizedSourceQuery = sourceQuery.trim().toLowerCase();
  const filteredSources = sources.filter((source) => {
    const matchesStatus = sourceStatus === "all"
      || (sourceStatus === "active" ? source.enabled : !source.enabled);
    const matchesType = sourceType === "all" || source.type === sourceType;
    const searchable = [source.name, source.url, sourceTypeConfig[source.type].label]
      .join(" ")
      .toLowerCase();
    return matchesStatus
      && matchesType
      && (!normalizedSourceQuery || searchable.includes(normalizedSourceQuery));
  });
  const hasSourceFilters = Boolean(sourceQuery)
    || sourceStatus !== "all"
    || sourceType !== "all";
  const resetSourceFilters = () => {
    setSourceQuery("");
    setSourceStatus("all");
    setSourceType("all");
  };

  const itemStats = [
    { featured: true, label: "Total items", value: items.length.toLocaleString() },
    { label: "Unprocessed", value: items.filter((r) => r.status === "unprocessed").length.toLocaleString() },
    { label: "High priority", value: items.filter((r) => r.priority === "high").length.toLocaleString() },
    { label: "Flagged for content", value: items.filter((r) => r.status.startsWith("flagged_")).length.toLocaleString() },
  ];

  const sourceStats = [
    { label: "Total sources", value: sources.length.toLocaleString() },
    { featured: true, label: "Active", value: sources.filter((s) => s.enabled).length.toLocaleString() },
    { label: "Disabled", value: sources.filter((s) => !s.enabled).length.toLocaleString() },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Research"
        description="Manage research content and sources"
      />

      <Tabs
        className="w-full"
        onValueChange={(value) => setActiveTab(value as "content" | "sources")}
        value={activeTab}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-6 space-y-8">
          {runPreconditionError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Research cannot start</p>
                  <p className="mt-1 text-sm text-muted-foreground">{runPreconditionError}</p>
                  <Button className="mt-3" onClick={() => setActiveTab("sources")} size="sm" variant="outline">
                    Review sources
                  </Button>
                </div>
              </div>
            </div>
          ) : researchStream.error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Research run failed</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {researchRunErrorMessage(researchStream.error)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Previously stored research items were not changed by this failed run.
                    {runJobId ? ` Run ${runJobId}.` : ""}
                  </p>
                  <Button className="mt-3" onClick={handleRunResearch} size="sm" variant="outline">
                    <RefreshCw className="size-4" /> Try research again
                  </Button>
                </div>
              </div>
            </div>
          ) : researchStream.isStreaming ? (
            <div className="space-y-4">
              <ReasoningTicker text={researchStream.reasoning} active />
              <StreamSection title="Researching sources" state="streaming">
                <ul className="space-y-1.5 text-sm" aria-live="polite">
                  {researchStream.progress.map((progress) => (
                    <li key={progress.id} className="animate-in fade-in flex items-center gap-2 duration-300">
                      <span className={progress.state === "done" ? "text-primary" : "animate-pulse text-muted-foreground"}>{progress.state === "done" ? "✓" : "…"}</span>
                      {progress.label}
                    </li>
                  ))}
                </ul>
                {streamedItems.length > 0 ? (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {streamedItems.length} finding{streamedItems.length === 1 ? "" : "s"} discovered
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {streamedItems.map((item, index) => (
                        <li key={`${item.title}-${index}`}>{item.title}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </StreamSection>
            </div>
          ) : researchStream.final ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4" role="status">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Research complete</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {researchStream.final.itemsCreated} new · {researchStream.final.itemsDeduped} already stored · {researchStream.final.sourcesSearched} source{researchStream.final.sourcesSearched === 1 ? "" : "s"} searched · {researchStream.final.creditsUsed} credits
                  </p>
                  {runJobId ? (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Run {runJobId}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <StatRow isLoading={itemsLoading} stats={itemStats} />

          {/* Research items */}
          <ListSurface
            count={filteredItems.length}
            description="Material gathered from your configured sources."
            emptyState={
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <BookOpen className="mb-4 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">
                  {searchQuery
                    ? `No research matches “${searchQuery}”`
                    : "No research items yet"}
                </p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {searchQuery
                    ? "Try another search term."
                    : "Research gathered from your sources collects here. Add sources and run research."}
                </p>
                {searchQuery ? (
                  <Button
                    className="mt-4"
                    onClick={() => setSearchQuery("")}
                    size="sm"
                    variant="outline"
                  >
                    Clear search
                  </Button>
                ) : null}
              </div>
            }
            filters={
              <Button
                disabled={runResearchLoading || sourcesLoading}
                onClick={handleRunResearch}
                size="sm"
              >
                {runResearchLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Run research
              </Button>
            }
            isLoading={itemsLoading}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by title or tags…"
            searchValue={searchQuery}
            title="Research items"
          >
            {!itemsLoading && filteredItems.length > 0 ? (
              <ListRows>
                {filteredItems.map((item) => {
                  const status = statusConfig[item.status];
                  const StatusIcon = status.icon;
                  const AddedByIcon = item.addedBy === "manual" ? User : Bot;
                  return (
                    <ListRow
                      actions={[
                        {
                          icon: Pencil,
                          label: `Edit ${item.title}`,
                          onSelect: () => openEditItem(item),
                        },
                        {
                          icon: Video,
                          label: `Flag ${item.title} for video`,
                          onSelect: () => void handleUpdateItemStatus(item, "flagged_for_video"),
                        },
                        {
                          icon: FileText,
                          label: `Flag ${item.title} for blog`,
                          onSelect: () => void handleUpdateItemStatus(item, "flagged_for_blog"),
                        },
                        {
                          icon: Hash,
                          label: `Flag ${item.title} for tweet`,
                          onSelect: () => void handleUpdateItemStatus(item, "flagged_for_tweet"),
                        },
                        {
                          destructive: true,
                          icon: Trash2,
                          label: `Delete ${item.title}`,
                          onSelect: () => setDeleteItemTarget(item),
                        },
                      ]}
                      badge={
                        <Badge className="flex w-fit items-center gap-1" variant={status.variant}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                      }
                      external
                      href={item.sourceUrl}
                      key={item.id}
                      leading={
                        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                          <AddedByIcon className="size-4" />
                        </span>
                      }
                      meta={[
                        ...(item.content ? [item.content] : []),
                        ...(item.humanNote ? [`Note: ${item.humanNote}`] : []),
                        item.tags.length > 0 ? item.tags.map((tag) => `#${tag}`).join(", ") : "No tags",
                        <span key="added" title={`Added by ${item.addedBy} — ${new Date(item.addedAt).toLocaleString()}`}>
                          {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true })}
                        </span>,
                      ]}
                      title={item.title}
                    />
                  );
                })}
              </ListRows>
            ) : null}
          </ListSurface>
        </TabsContent>

        <TabsContent value="sources" className="mt-6 space-y-8">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage websites and search terms to monitor for research content
            </p>
            <Dialog
              open={addSourceOpen}
              onOpenChange={(open) => {
                setAddSourceOpen(open);
                if (!open) setAddSourceError(null);
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" />
                  Add source
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add research source</DialogTitle>
                  <DialogDescription>
                    Add a website URL or search term to monitor for research
                    content.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="source-name">Name</Label>
                    <Input
                      id="source-name"
                      placeholder="e.g., LangChain Blog"
                      value={newSourceName}
                      onChange={(e) => {
                        setNewSourceName(e.target.value);
                        setAddSourceError(null);
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="source-type">Type</Label>
                    <Select
                      value={newSourceType}
                      onValueChange={(value: ResearchSourceType) => {
                        setNewSourceType(value);
                        setAddSourceError(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="website">Website</SelectItem>
                        <SelectItem value="search_term">Search term</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="source-url">
                      {newSourceType === "website" ? "URL" : "Search query"}
                    </Label>
                    <Input
                      aria-describedby={addSourceError ? "source-url-error" : undefined}
                      aria-invalid={Boolean(addSourceError)}
                      id="source-url"
                      placeholder={
                        newSourceType === "website"
                          ? "https://blog.langchain.dev"
                          : "LangGraph tutorials 2025"
                      }
                      value={newSourceUrl}
                      onChange={(e) => {
                        setNewSourceUrl(e.target.value);
                        setAddSourceError(null);
                      }}
                    />
                    {addSourceError ? (
                      <p className="text-sm text-destructive" id="source-url-error" role="alert">
                        {addSourceError}
                      </p>
                    ) : null}
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setAddSourceOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddSource}
                    disabled={
                      addSourceLoading || !newSourceName || !newSourceUrl
                    }
                  >
                    {addSourceLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Add source
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <StatRow isLoading={sourcesLoading} stats={sourceStats} />

          <ListSurface
            count={filteredSources.length}
            description="Websites and search terms monitored for new material."
            emptyState={
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <Globe className="mb-4 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">
                  {hasSourceFilters ? "No sources match these filters" : "No research sources yet"}
                </p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {hasSourceFilters
                    ? "Try a different search, status, or source type."
                    : "Add a website or search term to start monitoring research material."}
                </p>
                {hasSourceFilters ? (
                  <Button className="mt-4" onClick={resetSourceFilters} variant="outline">
                    Clear filters
                  </Button>
                ) : (
                  <Button className="mt-4" onClick={() => setAddSourceOpen(true)} variant="outline">
                    <Plus className="h-4 w-4" />
                    Add source
                  </Button>
                )}
              </div>
            }
            filters={
              <>
                {(["all", "active", "disabled"] as const).map((status) => (
                  <Button
                    key={status}
                    onClick={() => setSourceStatus(status)}
                    size="sm"
                    variant={sourceStatus === status ? "secondary" : "ghost"}
                  >
                    {status === "all" ? "All" : status === "active" ? "Active" : "Disabled"}
                  </Button>
                ))}
                <FilterSelect
                  label="Type"
                  onValueChange={(value) => setSourceType(value as "all" | ResearchSourceType)}
                  options={[
                    { value: "all", label: "All types" },
                    { value: "website", label: "Website" },
                    { value: "search_term", label: "Search term" },
                  ]}
                  value={sourceType}
                />
                {hasSourceFilters && (
                  <Button onClick={resetSourceFilters} size="sm" variant="ghost">
                    Clear
                  </Button>
                )}
              </>
            }
            isLoading={sourcesLoading}
            onSearchChange={setSourceQuery}
            searchPlaceholder="Search sources…"
            searchValue={sourceQuery}
            title="Research sources"
          >
            {!sourcesLoading && filteredSources.length > 0 ? (
              <ListRows>
                {filteredSources.map((source) => {
                  const typeConf = sourceTypeConfig[source.type];
                  const TypeIcon = typeConf.icon;
                  return (
                    <ListRow
                      actions={[
                        {
                          icon: source.enabled ? Pause : Play,
                          label: source.enabled ? `Disable ${source.name}` : `Enable ${source.name}`,
                          onSelect: () => void handleToggleSource(source),
                        },
                        {
                          destructive: true,
                          icon: Trash2,
                          label: `Remove ${source.name}`,
                          onSelect: () => setDeleteSourceTarget(source),
                        },
                      ]}
                      badge={
                        <Badge variant={source.enabled ? "default" : "secondary"}>
                          {source.enabled ? "Active" : "Disabled"}
                        </Badge>
                      }
                      external={source.type === "website"}
                      href={source.type === "website" ? source.url : undefined}
                      key={source.id}
                      leading={
                        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                          <TypeIcon className="size-4" />
                        </span>
                      }
                      meta={[
                        typeConf.label,
                        source.url,
                        <span key="created" title={new Date(source.createdAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(source.createdAt), { addSuffix: true })}
                        </span>,
                      ]}
                      title={source.name}
                    />
                  );
                })}
              </ListRows>
            ) : null}
          </ListSurface>
        </TabsContent>
      </Tabs>

      {/* Edit item */}
      <Dialog
        open={editItemTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditItemTarget(null);
            setEditItemError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit research item</DialogTitle>
            <DialogDescription>
              Curate the finding without changing its source identity or provenance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="research-item-title">Title</Label>
              <Input
                id="research-item-title"
                onChange={(event) => {
                  setEditItemTitle(event.target.value);
                  setEditItemError(null);
                }}
                value={editItemTitle}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="research-item-content">Finding</Label>
              <Textarea
                id="research-item-content"
                onChange={(event) => {
                  setEditItemContent(event.target.value);
                  setEditItemError(null);
                }}
                rows={5}
                value={editItemContent}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="research-item-priority">Priority</Label>
                <Select
                  onValueChange={(value: "low" | "medium" | "high") => setEditItemPriority(value)}
                  value={editItemPriority}
                >
                  <SelectTrigger id="research-item-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="research-item-tags">Tags</Label>
                <Input
                  id="research-item-tags"
                  onChange={(event) => setEditItemTags(event.target.value)}
                  placeholder="workflow, reliability"
                  value={editItemTags}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="research-item-note">Human note</Label>
              <Textarea
                id="research-item-note"
                onChange={(event) => setEditItemNote(event.target.value)}
                placeholder="Why this finding matters"
                rows={3}
                value={editItemNote}
              />
            </div>
            {editItemError ? (
              <p className="text-sm text-destructive" role="alert">{editItemError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={editItemLoading} onClick={() => setEditItemTarget(null)} variant="outline">
              Cancel
            </Button>
            <Button disabled={editItemLoading || !editItemTitle.trim() || !editItemContent.trim()} onClick={handleEditItem}>
              {editItemLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete source confirmation */}
      <Dialog
        open={deleteSourceTarget !== null}
        onOpenChange={(open) => !open && setDeleteSourceTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove source</DialogTitle>
            <DialogDescription>
              This permanently removes &ldquo;{deleteSourceTarget?.name}&rdquo; from your research
              sources so future runs no longer use it. Existing research items stay in Content.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSourceTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSource}>
              Remove source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete item confirmation */}
      <Dialog
        open={deleteItemTarget !== null}
        onOpenChange={(open) => !open && setDeleteItemTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete research item</DialogTitle>
            <DialogDescription>
              This permanently deletes &ldquo;{deleteItemTarget?.title}&rdquo;. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItemTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteItem}>
              Delete item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
