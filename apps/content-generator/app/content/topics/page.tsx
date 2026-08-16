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
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import { ReasoningTicker, StreamSection } from "@/components/genui";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";
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
  Plus,
  Sparkles,
  Bot,
  User,
  Trash2,
  Loader2,
  RotateCcw,
  Edit2,
  Hash,
} from "lucide-react";
import type { Topic, TopicsResponse } from "@/products/content-generator/domain/topic";

/**
 * Convert a display name to a canonical name (lowercase, hyphenated).
 */
function toCanonicalName(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Convert a canonical name to a title-cased display name.
 */
function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function TopicsPage() {
  // Topics state
  const [topicsData, setTopicsData] = useState<TopicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);

  // Add Topic Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit Topic Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTopic, setEditTopic] = useState<Topic | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Dismiss confirmation state
  const [dismissTarget, setDismissTarget] = useState<Topic | null>(null);

  const topicsStream = useCapabilityStream<{
    topics?: Array<{ display_name?: string; displayName?: string; name?: string }>;
  }, { topicsCreated: number }>({ api: "/content/topics/extract" });
  const generateLoading = topicsStream.isStreaming;

  // Reset Topics state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Fetch topics
  const fetchTopics = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: Topic[]; total: number; activeCount: number; dismissedCount: number }>(
        "/content/topics",
        { limit: 100, ...(showDismissed ? { includeDismissed: true } : {}) },
      );
      setTopicsData({ topics: data.items, total: data.total, activeCount: data.activeCount, dismissedCount: data.dismissedCount });
    } catch (error) {
      console.error("Error fetching topics:", error);
      toast.error("Could not load topics. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, [showDismissed]);

  // Handle name input - auto-generate display name
  const handleNameChange = (value: string) => {
    setNewName(value);
    // Auto-generate display name if user hasn't manually edited it
    if (!newDisplayName || newDisplayName === toDisplayName(newName)) {
      setNewDisplayName(toDisplayName(toCanonicalName(value)));
    }
  };

  // Add topic
  const handleAddTopic = async () => {
    if (!newName || !newDescription) return;

    setAddLoading(true);
    setAddError(null);

    try {
      try {
        await apiMutate("POST", "/content/topics", {
          name: toCanonicalName(newName),
          displayName: newDisplayName || toDisplayName(toCanonicalName(newName)),
          description: newDescription,
          source: "manual",
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setAddError("A topic with this name already exists (including dismissed topics)");
          return;
        }
        throw error;
      }

      toast.success("Topic added");
      setAddDialogOpen(false);
      setNewName("");
      setNewDisplayName("");
      setNewDescription("");
      fetchTopics();
    } catch (error) {
      console.error("Error adding topic:", error);
      toast.error("Could not add the topic. Try again.");
    } finally {
      setAddLoading(false);
    }
  };

  // Open edit dialog
  const openEditDialog = (topic: Topic) => {
    setEditTopic(topic);
    setEditDisplayName(topic.displayName);
    setEditDescription(topic.description);
    setEditDialogOpen(true);
  };

  // Update topic
  const handleUpdateTopic = async () => {
    if (!editTopic) return;

    setEditLoading(true);
    try {
      await apiMutate("PATCH", `/content/topics/${editTopic.id}`, {
        displayName: editDisplayName,
        description: editDescription,
      });

      toast.success("Topic updated");
      setEditDialogOpen(false);
      setEditTopic(null);
      fetchTopics();
    } catch (error) {
      console.error("Error updating topic:", error);
      toast.error("Could not update the topic. Try again.");
    } finally {
      setEditLoading(false);
    }
  };

  // Dismiss topic
  const handleDismissTopic = async () => {
    if (!dismissTarget) return;

    try {
      await apiMutate("POST", `/content/topics/${dismissTarget.id}/dismiss`);
      toast.success("Topic dismissed. Restore it from dismissed topics.");
      setDismissTarget(null);
      fetchTopics();
    } catch (error) {
      console.error("Error dismissing topic:", error);
      toast.error("Could not dismiss the topic. Try again.");
    }
  };

  // Restore topic
  const handleRestoreTopic = async (topic: Topic) => {
    try {
      await apiMutate("POST", `/content/topics/${topic.id}/restore`);
      toast.success("Topic restored");
      fetchTopics();
    } catch (error) {
      console.error("Error restoring topic:", error);
      toast.error("Could not restore the topic. Try again.");
    }
  };

  // Generate topics
  const handleGenerateTopics = () => topicsStream.start();
  useEffect(() => { if (topicsStream.final) void fetchTopics(); }, [topicsStream.final]);
  useEffect(() => { if (topicsStream.error) toast.error(topicsStream.error); }, [topicsStream.error]);

  // Reset all topics
  const handleResetTopics = async () => {
    setResetLoading(true);
    try {
      const { data } = await apiMutate<{ deletedCount: number }>("DELETE", "/content/topics", {
        confirm: "DELETE ALL TOPICS",
      });
      toast.success(`Deleted ${data.deletedCount} topics`);
      setResetDialogOpen(false);
      fetchTopics();
    } catch (error) {
      console.error("Error resetting topics:", error);
      toast.error("Could not reset topics. Try again.");
    } finally {
      setResetLoading(false);
    }
  };

  const topics = topicsData?.topics || [];

  const stats = [
    { label: "Total topics", value: (topicsData?.total || 0).toLocaleString() },
    { featured: true, label: "Active", value: (topicsData?.activeCount || 0).toLocaleString() },
    { label: "Dismissed", value: (topicsData?.dismissedCount || 0).toLocaleString() },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Topics"
        description="Manage content topics extracted from research"
        actions={
          <div className="flex items-center gap-2">
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4" />
                  Add topic
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add topic</DialogTitle>
                  <DialogDescription>
                    Create a topic manually. Topics organize research and inform
                    content planning.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="topic-name">Name</Label>
                    <Input
                      id="topic-name"
                      placeholder="e.g., Multi-Agent Systems"
                      value={newName}
                      onChange={(e) => handleNameChange(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Canonical: <span className="font-mono">{toCanonicalName(newName) || "..."}</span>
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="topic-display-name">Display name</Label>
                    <Input
                      id="topic-display-name"
                      placeholder="e.g., Multi-Agent Systems"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="topic-description">Description</Label>
                    <Textarea
                      id="topic-description"
                      placeholder="1-2 sentences explaining what this topic covers..."
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      rows={3}
                    />
                  </div>
                  {addError && (
                    <p className="text-xs text-destructive">{addError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddTopic}
                    disabled={addLoading || !newName || !newDescription}
                  >
                    {addLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Add topic
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button onClick={handleGenerateTopics} disabled={generateLoading}>
              {generateLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate topics
            </Button>
          </div>
        }
      />

      <div className="space-y-8">
        {topicsStream.isStreaming && (
          <div className="space-y-4">
            <ReasoningTicker text={topicsStream.reasoning} active />
            <StreamSection title="Discovering topics" state="streaming">
              <div className="flex flex-wrap gap-2">
                {(topicsStream.partial?.topics ?? []).filter((topic) => topic?.display_name || topic?.displayName || topic?.name).map((topic, index) => (
                  <span key={index} className="animate-in fade-in zoom-in-95 rounded-full border bg-muted/50 px-3 py-1 text-sm duration-300">
                    {topic.display_name ?? topic.displayName ?? topic.name}
                  </span>
                ))}
              </div>
            </StreamSection>
          </div>
        )}
        <StatRow isLoading={loading} stats={stats} />

        {/* Topics list */}
        <ListSurface
          count={topics.length}
          description="Subjects that organize research and guide content planning."
          emptyState={
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <Hash className="mb-4 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Topics that organize your research live here. Add one manually or generate them
                from research.
              </p>
            </div>
          }
          filters={
            <>
              <div className="flex items-center gap-2">
                <Switch
                  checked={showDismissed}
                  id="show-dismissed"
                  onCheckedChange={setShowDismissed}
                />
                <Label className="text-sm" htmlFor="show-dismissed">
                  Show dismissed topics
                </Label>
              </div>
              <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="ml-1"
                    disabled={resetLoading}
                    size="sm"
                    variant="destructive"
                  >
                    {resetLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Reset all
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete all topics</DialogTitle>
                    <DialogDescription>
                      This permanently deletes all {topicsData?.total ?? ""} topics, including
                      dismissed ones. This cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      disabled={resetLoading}
                      onClick={() => setResetDialogOpen(false)}
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={resetLoading}
                      onClick={handleResetTopics}
                      variant="destructive"
                    >
                      {resetLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Delete all topics
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          }
          isLoading={loading}
          title="Topics"
        >
          {!loading && topics.length > 0 ? (
            <ListRows>
              {topics.map((topic) => {
                const isDismissed = topic.status === "dismissed";
                const SourceIcon = topic.source === "manual" ? User : Bot;
                return (
                  <ListRow
                    actions={isDismissed ? [{
                      icon: RotateCcw,
                      label: `Restore ${topic.displayName}`,
                      onSelect: () => void handleRestoreTopic(topic),
                    }] : [
                      {
                        icon: Edit2,
                        label: `Edit ${topic.displayName}`,
                        onSelect: () => openEditDialog(topic),
                      },
                      {
                        destructive: true,
                        icon: Trash2,
                        label: `Dismiss ${topic.displayName}`,
                        onSelect: () => setDismissTarget(topic),
                      },
                    ]}
                    badge={isDismissed ? (
                      <Badge
                        title={topic.dismissedAt ? `Dismissed ${new Date(topic.dismissedAt).toLocaleString()}` : undefined}
                        variant="destructive"
                      >
                        Dismissed
                      </Badge>
                    ) : <Badge variant="default">Active</Badge>}
                    className={isDismissed ? "opacity-60" : undefined}
                    key={topic.id}
                    leading={
                      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                        <SourceIcon className="size-4" />
                      </span>
                    }
                    meta={[
                      topic.description,
                      <span className="font-mono" key="canonical">{topic.name}</span>,
                      topic.source === "manual" ? "Manual" : "Generated",
                      `${topic.mentionCount} ${topic.mentionCount === 1 ? "mention" : "mentions"}`,
                      <span key="created" title={new Date(topic.createdAt).toLocaleString()}>
                        {formatDistanceToNow(new Date(topic.createdAt), { addSuffix: true })}
                      </span>,
                    ]}
                    title={<span className={isDismissed ? "line-through" : undefined}>{topic.displayName}</span>}
                  />
                );
              })}
            </ListRows>
          ) : null}
        </ListSurface>
      </div>

      {/* Dismiss confirmation */}
      <Dialog
        open={dismissTarget !== null}
        onOpenChange={(open) => !open && setDismissTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss topic</DialogTitle>
            <DialogDescription>
              &ldquo;{dismissTarget?.displayName}&rdquo; is hidden from active topics. You can
              restore it later from dismissed topics.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleDismissTopic}>Dismiss topic</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit topic</DialogTitle>
            <DialogDescription>
              Update the display name or description of this topic.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Canonical name (read-only)</Label>
              <Input value={editTopic?.name || ""} disabled className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-display-name">Display name</Label>
              <Input
                id="edit-display-name"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateTopic} disabled={editLoading}>
              {editLoading && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
