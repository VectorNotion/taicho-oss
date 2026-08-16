"use client";

import { useState, useEffect, useCallback, useRef, use, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, GitBranch, Loader2, UserX } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDimensionResearch } from "@/products/outreach/ui/components/research/useDimensionResearch";

import {
  ProspectHero,
  ProspectDetailNavigation,
  QuickInfo,
  OutreachHistory,
  ActivityTimeline,
  AddActivityDialog,
  NextActionCard,
  ProspectNotes,
  ProspectIntelligenceTabs,
  ProspectDossierCard,
  ProspectResearchInsights,
  OutreachGenerationPanel,
  type OutreachDraftPartial,
  type ProspectNavigation,
  type Activity,
} from "@/components/prospects";
import type { ActionItem } from "@/products/outreach/domain/action-items";
import { useActionStream } from "@/hooks/use-action-stream";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProspectDossier } from "@/products/outreach/domain/prospect-dossier";
import type {
  Prospect,
  ProspectNote,
  ProspectStatus,
  OutreachMessage,
  OutreachMedium,
  ProspectActivity,
} from "@/products/outreach/domain/types";
import { callRecordingProspectUrl } from "@/products/outreach/ui/call-recording-link";
import type { CatalogItem } from "@/products/outreach/domain/catalog";

type ConfirmDelete =
  | { type: "prospect" }
  | { type: "activity"; id: string }
  | { type: "message"; id: string };

type NurtureFunnel = { id: string; name: string };

export function ProspectDetailPage({
  params,
  assistantAction,
}: {
  params: Promise<{ id: string }>;
  assistantAction?: ReactNode;
}) {
  const { id: routeProspectId } = use(params);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const prospectId = routeProspectId;
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [updatingCatalog, setUpdatingCatalog] = useState(false);
  const [navigation, setNavigation] = useState<ProspectNavigation | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationError, setNavigationError] = useState(false);
  const [outreachMessages, setOutreachMessages] = useState<OutreachMessage[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(true);
  const [outreachMedium, setOutreachMedium] = useState<OutreachMedium | null>(null);
  const generationAttemptRef = useRef<{ key: string; id: string } | null>(null);
  const [showOutreachCompletion, setShowOutreachCompletion] = useState(false);
  const [contentCommentDialogOpen, setContentCommentDialogOpen] = useState(false);
  const [targetContent, setTargetContent] = useState("");
  const [addActivityDialogOpen, setAddActivityDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [dossier, setDossier] = useState<ProspectDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(true);
  const [notes, setNotes] = useState<ProspectNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [activities, setActivities] = useState<ProspectActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [actionItemsLoading, setActionItemsLoading] = useState(true);
  const [isSubmittingActivity, setIsSubmittingActivity] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nurtureFunnels, setNurtureFunnels] = useState<NurtureFunnel[] | null>(null);
  const [nurtureDialogOpen, setNurtureDialogOpen] = useState(false);
  const [selectedFunnelId, setSelectedFunnelId] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const qualifyStream = useActionStream<{ score?: number; notes?: string }, { score?: number }>({
    api: `/api/outreach/prospects/${prospectId}/qualify/stream`,
  });
  const personResearch = useDimensionResearch(
    `/api/outreach/prospects/${prospectId}/research/person/stream`,
    { primaryScope: "person" },
  );
  const accountResearch = useDimensionResearch(
    `/api/outreach/prospects/${prospectId}/research/account/stream`,
    { primaryScope: "account" },
  );
  const outreachGeneration = useActionStream<OutreachDraftPartial, OutreachMessage>({
    api: `/api/outreach/prospects/${prospectId}/outreach/stream`,
  });
  const isGeneratingOutreach = outreachGeneration.isStreaming;

  const fetchDossier = useCallback(async (options?: { silent?: boolean }) => {
    if (!prospectId) return;
    if (!options?.silent) setDossierLoading(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/dossier`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch dossier");
      setDossier(await response.json());
    } catch (error) {
      console.error("Error fetching dossier:", error);
      toast.error("Could not load the sales-intelligence dossier — refresh to try again");
    } finally {
      if (!options?.silent) setDossierLoading(false);
    }
  }, [prospectId]);

  // Fetch prospect data
  useEffect(() => {
    let cancelled = false;
    async function fetchProspect() {
      setIsLoading(true);
      setProspect(null);
      try {
        const response = await fetch(`/api/outreach/prospects/${routeProspectId}`);
        if (!response.ok) throw new Error("Failed to fetch prospect");

        const data = await response.json();
        if (!cancelled) setProspect(data);
      } catch (error) {
        if (cancelled) return;
        console.error("Error fetching prospect:", error);
        toast.error("Could not load this person — refresh to try again");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void fetchProspect();
    return () => { cancelled = true; };
  }, [routeProspectId]);

  useEffect(() => {
    void fetch("/api/outreach/catalog")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((items: CatalogItem[]) => setCatalog(items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function refreshAfterAssistant() {
      void Promise.all([
        fetch(`/api/outreach/prospects/${prospectId}`, { cache: "no-store" }),
        fetch(`/api/outreach/prospects/${prospectId}/outreach`, { cache: "no-store" }),
        fetch(`/api/outreach/prospects/${prospectId}/notes`, { cache: "no-store" }),
        fetch(`/api/outreach/prospects/${prospectId}/activities`, { cache: "no-store" }),
        fetch(`/api/outreach/action-items?prospectId=${encodeURIComponent(prospectId)}`, { cache: "no-store" }),
      ]).then(async ([prospectResponse, outreachResponse, notesResponse, activitiesResponse, actionsResponse]) => {
        if (prospectResponse.ok) setProspect(await prospectResponse.json());
        if (outreachResponse.ok) setOutreachMessages(await outreachResponse.json());
        if (notesResponse.ok) setNotes(await notesResponse.json());
        if (activitiesResponse.ok) setActivities(await activitiesResponse.json());
        if (actionsResponse.ok) {
          const data = await actionsResponse.json();
          setActionItems(data.items as ActionItem[]);
        }
      }).catch(() => undefined);
      void fetchDossier({ silent: true });
    }
    window.addEventListener("prospect-chat-closed", refreshAfterAssistant);
    return () => window.removeEventListener("prospect-chat-closed", refreshAfterAssistant);
  }, [fetchDossier, prospectId]);

  async function handleCatalogChange(value: string) {
    setUpdatingCatalog(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemId: value === "none" ? null : value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Catalog context could not be updated");
      setProspect(result);
      await fetchDossier({ silent: true });
      toast.success(value === "none" ? "Catalog context cleared" : "Catalog context updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Catalog context could not be updated");
    } finally {
      setUpdatingCatalog(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setNavigationLoading(true);
    setNavigationError(false);
    setNavigation(null);
    void fetch(`/api/outreach/prospects/${routeProspectId}/navigation`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.ok
        ? response.json()
        : Promise.reject(new Error("Failed to fetch navigation")))
      .then((data: ProspectNavigation) => setNavigation(data))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("Error fetching prospect navigation:", error);
          setNavigationError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setNavigationLoading(false);
      });
    return () => controller.abort();
  }, [routeProspectId]);

  // Nurture is an optional entitlement and does not exist in the standalone
  // Outreach shell. A successful response enables the cross-product handoff;
  // 403/404 deliberately leave the action hidden.
  useEffect(() => {
    void fetch("/api/cascade/funnels")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((funnels: NurtureFunnel[]) => setNurtureFunnels(funnels))
      .catch(() => setNurtureFunnels(null));
  }, []);

  // Fetch outreach messages
  useEffect(() => {
    async function fetchOutreach() {
      if (!prospectId) return;

      setOutreachLoading(true);
      try {
        const response = await fetch(`/api/outreach/prospects/${prospectId}/outreach`);
        if (!response.ok) throw new Error("Failed to fetch outreach messages");

        const data = await response.json();
        setOutreachMessages(data);
      } catch (error) {
        console.error("Error fetching outreach:", error);
        toast.error("Could not load outreach history — refresh to try again");
      } finally {
        setOutreachLoading(false);
      }
    }
    fetchOutreach();
  }, [prospectId]);

  useEffect(() => {
    if (!qualifyStream.final || !prospectId) return;
    void fetchDossier({ silent: true });
  }, [qualifyStream.final, fetchDossier, prospectId]);
  useEffect(() => { if (qualifyStream.error) toast.error(qualifyStream.error); }, [qualifyStream.error]);

  // One endpoint provides the account, person, and qualification snapshot so
  // scores from different refreshes are never stitched together in the UI.
  useEffect(() => {
    void fetchDossier();
  }, [fetchDossier]);

  useEffect(() => {
    if (!personResearch.final || !prospectId) return;
    toast.success("Person research complete");
    void fetchDossier({ silent: true });
  }, [personResearch.final, fetchDossier, prospectId]);
  useEffect(() => { if (personResearch.error) toast.error(personResearch.error); }, [personResearch.error]);

  useEffect(() => {
    if (!accountResearch.final || !prospectId) return;
    toast.success("Account research complete");
    void fetchDossier({ silent: true });
  }, [accountResearch.final, fetchDossier, prospectId]);
  useEffect(() => { if (accountResearch.error) toast.error(accountResearch.error); }, [accountResearch.error]);

  // The AI SDK stream saves the completed artifact before emitting `final`.
  // Move that durable message into the visible draft history immediately; the
  // operational generation surface then yields back to the saved draft.
  useEffect(() => {
    const message = outreachGeneration.final;
    if (!message) return;
    generationAttemptRef.current = null;
    setShowOutreachCompletion(true);
    setOutreachMessages((current) => [
      message,
      ...current.filter(({ id }) => id !== message.id),
    ]);
    setContentCommentDialogOpen(false);
    setTargetContent("");
    if (message.nextAction) {
      setActionItems((current) => [
        message.nextAction!,
        ...current.filter((item) => item.source !== "auto_followup" && item.id !== message.nextAction!.id),
      ]);
      setActionItemsLoading(false);
    }
    toast.success("Customer-first outreach draft ready");
    const completionTimer = window.setTimeout(() => setShowOutreachCompletion(false), 1_800);
    return () => window.clearTimeout(completionTimer);
  }, [outreachGeneration.final]);
  useEffect(() => {
    if (outreachGeneration.error) toast.error(outreachGeneration.error);
  }, [outreachGeneration.error]);

  // Fetch notes
  useEffect(() => {
    async function fetchNotes() {
      if (!prospectId) return;

      setNotesLoading(true);
      try {
        const response = await fetch(`/api/outreach/prospects/${prospectId}/notes`);
        if (!response.ok) throw new Error("Failed to fetch notes");

        const data = await response.json();
        setNotes(data);
      } catch (error) {
        console.error("Error fetching notes:", error);
        toast.error("Could not load notes — refresh to try again");
      } finally {
        setNotesLoading(false);
      }
    }
    fetchNotes();
  }, [prospectId]);

  // Fetch activities
  useEffect(() => {
    async function fetchActivities() {
      if (!prospectId) return;

      setActivitiesLoading(true);
      try {
        const response = await fetch(`/api/outreach/prospects/${prospectId}/activities`);
        if (!response.ok) throw new Error("Failed to fetch activities");

        const data = await response.json();
        setActivities(data);
      } catch (error) {
        console.error("Error fetching activities:", error);
        toast.error("Could not load activities — refresh to try again");
      } finally {
        setActivitiesLoading(false);
      }
    }
    fetchActivities();
  }, [prospectId]);

  const refreshActivities = async () => {
    const response = await fetch(`/api/outreach/prospects/${prospectId}/activities`);
    if (response.ok) setActivities(await response.json());
  };

  const refreshActionItems = async () => {
    try {
      const response = await fetch(
        `/api/outreach/action-items?prospectId=${encodeURIComponent(prospectId)}`,
      );
      if (!response.ok) throw new Error("Failed to load action items");
      const data = await response.json();
      setActionItems(data.items as ActionItem[]);
    } catch (error) {
      console.error("Error fetching action items:", error);
      toast.error("Could not load the next action — refresh to try again");
    } finally {
      setActionItemsLoading(false);
    }
  };

  // Fetch action items
  useEffect(() => {
    if (!prospectId) return;
    void refreshActionItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectId]);

  const handleCompleteActionItem = async (id: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!response.ok) throw new Error("Failed to complete action item");
      toast.success("Action completed");
      await Promise.all([refreshActionItems(), refreshActivities()]);
    } catch (error) {
      console.error("Error completing action item:", error);
      toast.error("Could not complete the action");
    }
  };

  const handleDeleteActionItem = async (id: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete action item");
      toast.success("Upcoming action removed");
      await refreshActionItems();
    } catch (error) {
      console.error("Error deleting action item:", error);
      toast.error("Could not remove the action");
    }
  };

  const handleSnoozeActionItem = async (id: string, dueAt: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt }),
      });
      if (!response.ok) throw new Error("Failed to snooze action item");
      toast.success("Snoozed");
      await refreshActionItems();
    } catch (error) {
      console.error("Error snoozing action item:", error);
      toast.error("Could not snooze the action");
    }
  };

  const handleEditActionItem = async (id: string, title: string, dueAt: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt }),
      });
      if (!response.ok) throw new Error("Failed to update action item");
      toast.success("Next action updated");
      await refreshActionItems();
    } catch (error) {
      console.error("Error updating action item:", error);
      toast.error("Could not update the action");
    }
  };

  const handleCreateActionItem = async (title: string, dueAt: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt, prospectId }),
      });
      if (!response.ok) throw new Error("Failed to create action item");
      toast.success("Next action set");
      await refreshActionItems();
    } catch (error) {
      console.error("Error creating action item:", error);
      toast.error("Could not set the next action");
    }
  };

  const handleAddNote = async (content: string) => {
    const response = await fetch(`/api/outreach/prospects/${prospectId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) throw new Error("Failed to add note");

    const newNote = await response.json();
    setNotes((prev) => [newNote, ...prev]);
  };

  const handleDeleteNote = async (noteId: string) => {
    const response = await fetch(`/api/outreach/prospects/${prospectId}/notes/${noteId}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete note");

    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleAddActivity = async (data: Omit<Activity, "id" | "createdAt" | "prospectId">) => {
    setIsSubmittingActivity(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error("Failed to add activity");

      const newActivity = await response.json();
      setActivities((prev) => [newActivity, ...prev]);
      setAddActivityDialogOpen(false);
      setEditingActivity(null);
      toast.success("Activity added");
      // Contact-type activities auto-create a follow-up server-side
      // (fire-and-forget), so give the insert a beat before refreshing.
      setTimeout(() => void refreshActionItems(), 600);
    } catch (error) {
      console.error("Error adding activity:", error);
      toast.error("Could not add the activity — try again");
    } finally {
      setIsSubmittingActivity(false);
    }
  };

  const handleUpdateActivity = async (data: Omit<Activity, "id" | "createdAt" | "prospectId">) => {
    if (!editingActivity) return;

    setIsSubmittingActivity(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/activities/${editingActivity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error("Failed to update activity");

      const updatedActivity = await response.json();
      setActivities((prev) =>
        prev.map((a) => (a.id === editingActivity.id ? updatedActivity : a))
      );
      setAddActivityDialogOpen(false);
      setEditingActivity(null);
      toast.success("Activity updated");
    } catch (error) {
      console.error("Error updating activity:", error);
      toast.error("Could not update the activity — try again");
    } finally {
      setIsSubmittingActivity(false);
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/activities/${activityId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete activity");

      setActivities((prev) => prev.filter((a) => a.id !== activityId));
      toast.success("Activity deleted");
    } catch (error) {
      console.error("Error deleting activity:", error);
      toast.error("Could not delete the activity — try again");
    }
  };

  const handleStatusChange = async (newStatus: ProspectStatus) => {
    if (!prospect) return;

    setUpdatingStatus(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update status");

      const updated = await response.json();
      setProspect(updated);
      const activityResponse = await fetch(`/api/outreach/prospects/${prospectId}/activities`);
      if (activityResponse.ok) setActivities(await activityResponse.json());
      toast.success("Status updated");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Could not update the status — try again");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleGenerateOutreach = (medium: OutreachMedium, targetContentValue?: string) => {
    setShowOutreachCompletion(false);
    setOutreachMedium(medium);
    if (medium === "content_comment") setContentCommentDialogOpen(false);
    const generationKey = `${medium}:${targetContentValue ?? ""}`;
    const generationId = generationAttemptRef.current?.key === generationKey
      ? generationAttemptRef.current.id
      : crypto.randomUUID();
    generationAttemptRef.current = { key: generationKey, id: generationId };
    outreachGeneration.start({
      medium,
      generationId,
      ...(targetContentValue ? { targetContent: targetContentValue } : {}),
    });
  };

  const handleToggleMessageStatus = async (message: OutreachMessage) => {
    const newStatus = message.status === "draft" ? "sent" : "draft";
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/outreach/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Failed to update message status");
      }

      const updated = await response.json();
      setOutreachMessages((prev) =>
        prev.map((m) => (m.id === message.id ? updated : m))
      );
      if (newStatus === "sent") {
        const activityResponse = await fetch(`/api/outreach/prospects/${prospectId}/activities`);
        if (activityResponse.ok) setActivities(await activityResponse.json());
        // Sending stamps lastContactedAt and may auto-create a follow-up
        // server-side (fire-and-forget); give the insert a beat.
        setTimeout(() => void refreshActionItems(), 600);
      }
      toast.success(newStatus === "sent" ? "Message marked as sent externally" : "Message moved back to drafts");
    } catch (error) {
      console.error("Error updating message status:", error);
      toast.error(error instanceof Error
        ? error.message
        : "Could not update the message status — try again");
    }
  };

  const openNurtureDialog = () => {
    setEnrollEmail(prospect?.email ?? "");
    setSelectedFunnelId(nurtureFunnels?.[0]?.id ?? "");
    setNurtureDialogOpen(true);
  };

  const handleAddToFunnel = async () => {
    if (!prospect || !selectedFunnelId || !enrollEmail.includes("@")) return;
    const funnel = nurtureFunnels?.find((item) => item.id === selectedFunnelId);
    setIsEnrolling(true);
    try {
      const response = await fetch(`/api/cascade/funnels/${selectedFunnelId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: enrollEmail.trim(),
          workspaceContactId: prospect.id,
          attributes: {
            name: prospect.name,
            company: prospect.company,
            title: prospect.title,
            prospectStatus: prospect.status,
            source: "outreach",
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not add this person");

      if (prospect.email !== enrollEmail.trim()) {
        const updateResponse = await fetch(`/api/outreach/prospects/${prospect.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: enrollEmail.trim() }),
        });
        if (updateResponse.ok) setProspect(await updateResponse.json());
      }

      const activityResponse = await fetch(`/api/outreach/prospects/${prospect.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "nurture_enrolled",
          title: `Added to ${funnel?.name ?? "funnel"}`,
          metadata: { funnelId: selectedFunnelId, funnelName: funnel?.name },
        }),
      });
      if (activityResponse.ok) {
        const activity = await activityResponse.json();
        setActivities((current) => [activity, ...current]);
      }

      toast.success(`${prospect.name} added to ${funnel?.name ?? "funnel"}`);
      setNurtureDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add this person");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/outreach/${messageId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete message");

      setOutreachMessages((prev) => prev.filter((m) => m.id !== messageId));
      toast.success("Message deleted");
    } catch (error) {
      console.error("Error deleting message:", error);
      toast.error("Could not delete the message — try again");
    }
  };

  const handleDelete = async () => {
    if (!prospect) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast.success("Person removed from Outreach");
      router.push("/outreach/prospects");
    } catch (error) {
      console.error("Error deleting prospect:", error);
      toast.error("Could not remove the person from Outreach — try again");
      setIsDeleting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setConfirmBusy(true);
    try {
      if (confirmDelete.type === "prospect") {
        await handleDelete();
      } else if (confirmDelete.type === "activity") {
        await handleDeleteActivity(confirmDelete.id);
      } else {
        await handleDeleteMessage(confirmDelete.id);
      }
    } finally {
      setConfirmBusy(false);
      setConfirmDelete(null);
    }
  };

  const confirmCopy =
    confirmDelete?.type === "prospect"
      ? {
          title: "Remove from Outreach",
          description: `This removes ${prospect?.name ?? "this person"} from your Outreach prospects. Their shared People record remains available to the workspace.`,
          action: "Remove from Outreach",
        }
      : confirmDelete?.type === "activity"
        ? {
            title: "Delete activity",
            description: "This permanently removes the activity from the timeline.",
            action: "Delete activity",
          }
        : {
            title: "Delete message",
            description: "This permanently removes the outreach message.",
            action: "Delete message",
          };

  if (isLoading) {
    return (
      <div className="w-full min-w-0 space-y-8">
        <div>
          <Skeleton className="mb-4 h-5 w-24" />
          <Skeleton className="h-44 w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="w-full min-w-0">
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <UserX className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This person is not currently in the Outreach prospects list
          </p>
          <Button variant="outline" asChild>
            <Link href="/outreach/prospects">Back to prospects</Link>
          </Button>
        </div>
      </div>
    );
  }

  const personaInsights = dossier ? {
    personaScore: dossier.person.personaScore,
    dimensions: dossier.person.findings.map((finding) => ({
      dimensionKey: finding.dimensionKey,
      observedValue: finding.observedValue,
      evidence: finding.evidence,
      confidence: finding.confidence,
      matchScore: finding.match?.matchScore,
      effectiveMatch: finding.match?.effectiveMatch,
      classification: finding.match?.classification,
      hardExclusion: finding.match?.hardExclusion,
    })),
  } : null;
  const accountInsights = dossier?.account ? {
    id: dossier.account.id,
    name: dossier.account.name,
    prospectCount: dossier.account.prospectCount,
    qualifiedCount: dossier.account.qualifiedCount,
    icpScore: dossier.account.icpScore,
    timingScore: dossier.account.timingScore,
    isTarget: dossier.account.isTarget,
    hardExcluded: dossier.account.hardExcluded,
    computedAt: dossier.account.computedAt ?? undefined,
    icpObservations: dossier.account.fitFindings.map((finding) => ({
      dimensionKey: finding.dimensionKey,
      observedValue: finding.observedValue,
      evidence: finding.evidence,
      effectiveMatch: finding.match?.effectiveMatch,
      hardExclusion: finding.match?.hardExclusion,
    })),
    timingSignals: dossier.account.timingFindings.map((finding) => ({
      dimensionKey: finding.dimensionKey,
      signals: finding.signals,
      dimensionValue: finding.dimensionValue ?? undefined,
      signalCount: finding.signalCount,
    })),
  } : null;
  return (
    <div className="w-full min-w-0 space-y-8">
      {/* Keep collection navigation separate from prospect-to-prospect navigation. */}
      <div>
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/prospects"
        >
          <ArrowLeft className="size-4" /> Prospects
        </Link>
        <ProspectDetailNavigation
          hasError={navigationError}
          isLoading={navigationLoading}
          navigation={navigation}
        />
        <ProspectHero
          prospect={prospect}
          assistantAction={assistantAction}
          callRecordingUrl={callRecordingProspectUrl(prospect.id)}
          isDeleting={isDeleting}
          updatingStatus={updatingStatus}
          onStatusChange={handleStatusChange}
          onDelete={() => setConfirmDelete({ type: "prospect" })}
          nurtureAction={nurtureFunnels ? (
            <Button aria-label="Add to funnel" size="sm" variant="outline" onClick={openNurtureDialog}>
              <GitBranch className="h-4 w-4" />
              <span className="hidden sm:inline">Add to funnel</span>
            </Button>
          ) : undefined}
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><BookOpen className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Catalog context</p>
            <p className="text-xs text-muted-foreground">Research, qualification, chat, and outreach use the selected commercial angle.</p>
          </div>
          <Select disabled={updatingCatalog} value={prospect.catalogItemId ?? "none"} onValueChange={(value) => void handleCatalogChange(value)}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Catalog context"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Catalog item selected</SelectItem>
              {catalog.map((item) => <SelectItem disabled={item.status === "archived" && item.id !== prospect.catalogItemId} key={item.id} value={item.id}>{item.name}{item.status === "archived" ? " (archived)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <ProspectDossierCard
        dossier={dossier}
        isLoading={dossierLoading}
        isRequalifying={qualifyStream.isStreaming}
        onRequalify={() => qualifyStream.start()}
      />

      <ProspectIntelligenceTabs
        prospectId={prospectId}
        prospectName={prospect.name}
        notesVersion={[
          notes.map((note) => `${note.id}:${note.updatedAt ?? note.createdAt}`).join(","),
          activities.map((activity) => `${activity.id}:${activity.updatedAt ?? activity.createdAt}`).join(","),
          outreachMessages.map((message) => `${message.id}:${message.status}:${message.sentAt ?? ""}`).join(","),
          prospect.status,
        ].join("|")}
        notes={(
          <ProspectNotes
            notes={notes}
            isLoading={notesLoading}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
          />
        )}
        overview={(
          <div className="space-y-4">
            <ProspectResearchInsights
              account={accountInsights}
              accountLoading={dossierLoading}
              accountNeedsResolution={dossier?.accountResolution.state === "available"}
              accountResearchAvailable={Boolean(prospect.company?.trim())}
              accountResearchDimensions={accountResearch.dimensions}
              accountResearchError={accountResearch.error}
              companyName={prospect.company || undefined}
              isResearchingAccount={accountResearch.isStreaming}
              isResearchingPerson={personResearch.isStreaming}
              onResearchAccount={() => accountResearch.start()}
              onResearchPerson={() => personResearch.start()}
              persona={personaInsights}
              personaLoading={dossierLoading}
              personResearchDimensions={personResearch.dimensions}
              personResearchError={personResearch.error}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4">
                <QuickInfo prospect={prospect} />
              </div>

              <div className="space-y-4 lg:col-span-2">
                <NextActionCard
                  items={actionItems}
                  isLoading={actionItemsLoading}
                  onComplete={handleCompleteActionItem}
                  onSnooze={handleSnoozeActionItem}
                  onCreate={handleCreateActionItem}
                  onDelete={handleDeleteActionItem}
                  onEdit={handleEditActionItem}
                />
                <ActivityTimeline
                  activities={activities}
                  isLoading={activitiesLoading}
                  onAddActivity={() => {
                    setEditingActivity(null);
                    setAddActivityDialogOpen(true);
                  }}
                  onEditActivity={(activity) => {
                    setEditingActivity(activity);
                    setAddActivityDialogOpen(true);
                  }}
                  onDeleteActivity={(activityId) =>
                    setConfirmDelete({ type: "activity", id: activityId })
                  }
                />

                {prospect.about && (
                  <Card>
                    <CardHeader>
                      <CardTitle>About</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{prospect.about}</p>
                    </CardContent>
                  </Card>
                )}

                <OutreachGenerationPanel
                  error={outreachGeneration.error}
                  isComplete={showOutreachCompletion}
                  isStreaming={outreachGeneration.isStreaming}
                  medium={outreachMedium}
                  partial={outreachGeneration.partial}
                  progress={outreachGeneration.progress}
                  prospectName={prospect.name}
                />

                <OutreachHistory
                  messages={outreachMessages}
                  isLoading={outreachLoading}
                  isGenerating={isGeneratingOutreach}
                  prospectName={prospect.name}
                  onGenerate={handleGenerateOutreach}
                  onOpenCommentDialog={() => setContentCommentDialogOpen(true)}
                  onToggleStatus={handleToggleMessageStatus}
                  onDelete={(messageId) => setConfirmDelete({ type: "message", id: messageId })}
                />
              </div>
            </div>
          </div>
        )}
      />

      {/* Add Activity Dialog */}
      <AddActivityDialog
        open={addActivityDialogOpen}
        onOpenChange={setAddActivityDialogOpen}
        editActivity={editingActivity}
        isSubmitting={isSubmittingActivity}
        onSubmit={(activity) => {
          if (editingActivity) {
            handleUpdateActivity(activity);
          } else {
            handleAddActivity(activity);
          }
        }}
      />

      <Dialog open={nurtureDialogOpen} onOpenChange={setNurtureDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {prospect.name} to a funnel</DialogTitle>
            <DialogDescription>
              Choose the people list. The same workspace Contact gains a Nurture role while remaining an Outreach target.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="nurture-funnel">Funnel</Label>
              <Select value={selectedFunnelId} onValueChange={setSelectedFunnelId}>
                <SelectTrigger id="nurture-funnel"><SelectValue placeholder="Choose a funnel" /></SelectTrigger>
                <SelectContent>
                  {(nurtureFunnels ?? []).map((funnel) => (
                    <SelectItem key={funnel.id} value={funnel.id}>{funnel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {nurtureFunnels?.length === 0 && (
                <p className="text-xs text-muted-foreground">Create a funnel in Nurture before adding this person.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nurture-email">Email</Label>
              <Input id="nurture-email" type="email" value={enrollEmail} onChange={(event) => setEnrollEmail(event.target.value)} placeholder="person@company.com" />
              {!prospect.email && <p className="text-xs text-muted-foreground">This email will also be saved on the shared People record.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNurtureDialogOpen(false)} disabled={isEnrolling}>Cancel</Button>
            <Button onClick={handleAddToFunnel} disabled={isEnrolling || !selectedFunnelId || !enrollEmail.includes("@")}>
              {isEnrolling && <Loader2 className="h-4 w-4 animate-spin" />}
              Add person
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmCopy.title}</DialogTitle>
            <DialogDescription>{confirmCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={confirmBusy || isDeleting}
            >
              {(confirmBusy || isDeleting) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {confirmCopy.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Content Comment Dialog */}
      <Dialog open={contentCommentDialogOpen} onOpenChange={setContentCommentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate content comment</DialogTitle>
            <DialogDescription>
              Paste the content you want to comment on. The AI will generate a relevant,
              personalized comment based on the person&apos;s profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Paste the post, tweet, or article content here..."
              value={targetContent}
              onChange={(e) => setTargetContent(e.target.value)}
              rows={6}
              aria-label="Content to comment on"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setContentCommentDialogOpen(false);
                setTargetContent("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleGenerateOutreach("content_comment", targetContent)}
              disabled={!targetContent.trim() || isGeneratingOutreach}
            >
              {isGeneratingOutreach && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProspectDetailPage;
