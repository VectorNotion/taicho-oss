"use client";

import { useState, useEffect, useCallback, use } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ExternalLink, GitBranch, Loader2, Search, UserX } from "lucide-react";
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
import { DimensionResearchSurface } from "@/products/outreach/ui/components/research/DimensionResearchSurface";
import { ScoreRing } from "@/components/genui";

import { ProspectHero, QuickInfo, OutreachHistory, ActivityTimeline, AddActivityDialog, NextActionCard, ProspectNotes, ProspectIntelligenceTabs, CompanySummaryBar, type CompanySummary, type Activity } from "@/components/prospects";
import type { ActionItem } from "@/products/outreach/domain/action-items";
import { QualificationCard } from "@/components/prospects/QualificationCard";
import { useActionStream } from "@/hooks/use-action-stream";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProspectQualificationResult } from "@/products/outreach/domain/qualification";
import type {
  Prospect,
  ProspectNote,
  ProspectStatus,
  LegacyQualification,
  OutreachMessage,
  OutreachMedium,
  ProspectActivity,
} from "@/products/outreach/domain/types";
import { callRecordingProspectUrl } from "@/products/outreach/ui/call-recording-link";

/** One persona (prospect-fit) dimension: what we wanted → what research found → how it matched. */
type PersonaDimension = {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  matchScore?: number;
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
};

type PersonaPayload = { dimensions: PersonaDimension[]; personaScore: number | null };

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

type ConfirmDelete =
  | { type: "prospect" }
  | { type: "activity"; id: string }
  | { type: "message"; id: string };

type NurtureFunnel = { id: string; name: string };

/** GET /qualify payload: new dimension-based result plus the legacy flat score. */
type QualificationPayload = {
  prospect: ProspectQualificationResult | null;
  legacy: LegacyQualification | null;
};

export default function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: routeProspectId } = use(params);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [prospectId] = useState(routeProspectId);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [outreachMessages, setOutreachMessages] = useState<OutreachMessage[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(true);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [contentCommentDialogOpen, setContentCommentDialogOpen] = useState(false);
  const [targetContent, setTargetContent] = useState("");
  const [addActivityDialogOpen, setAddActivityDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [persona, setPersona] = useState<PersonaPayload | null>(null);
  const [personaLoading, setPersonaLoading] = useState(true);
  const [qualification, setQualification] = useState<QualificationPayload | null>(null);
  const [qualificationLoading, setQualificationLoading] = useState(true);
  const [account, setAccount] = useState<CompanySummary | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
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
  const research = useDimensionResearch(`/api/outreach/prospects/${prospectId}/research/stream`);

  const fetchPersona = useCallback(async () => {
    if (!prospectId) return;
    setPersonaLoading(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/persona`);
      if (!response.ok) throw new Error("Failed to fetch persona");
      setPersona(await response.json());
    } catch (error) {
      console.error("Error fetching persona:", error);
      toast.error("Could not load persona fit — refresh to try again");
    } finally {
      setPersonaLoading(false);
    }
  }, [prospectId]);

  const fetchAccount = useCallback(async () => {
    if (!prospectId) return;
    setAccountLoading(true);
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/account`);
      if (!response.ok) throw new Error("Failed to fetch account");
      const data = await response.json();
      setAccount(data.account ?? null);
    } catch (error) {
      console.error("Error fetching account:", error);
      setAccount(null);
    } finally {
      setAccountLoading(false);
    }
  }, [prospectId]);

  // Fetch prospect data
  useEffect(() => {
    async function fetchProspect() {
      try {
        const response = await fetch(`/api/outreach/prospects/${routeProspectId}`);
        if (!response.ok) throw new Error("Failed to fetch prospect");

        const data = await response.json();
        setProspect(data);
      } catch (error) {
        console.error("Error fetching prospect:", error);
        toast.error("Could not load this person — refresh to try again");
      } finally {
        setIsLoading(false);
      }
    }
    fetchProspect();
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
    void fetch(`/api/outreach/prospects/${prospectId}/qualify`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to fetch qualification')))
      .then(setQualification)
      .catch(() => toast.error("Qualification completed, but the result could not be refreshed"));
  }, [qualifyStream.final, prospectId]);
  useEffect(() => { if (qualifyStream.error) toast.error(qualifyStream.error); }, [qualifyStream.error]);

  // Fetch persona (prospect fit) detail
  useEffect(() => {
    void fetchPersona();
  }, [fetchPersona]);

  // Fetch the prospect's company as an account summary (fit / timing / target).
  useEffect(() => {
    void fetchAccount();
  }, [fetchAccount]);

  // When dimension research finishes, refresh persona fit + qualification.
  useEffect(() => {
    if (!research.final || !prospectId) return;
    toast.success("Research complete");
    void fetchPersona();
    void fetchAccount();
    void fetch(`/api/outreach/prospects/${prospectId}/qualify`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Failed to fetch qualification"))))
      .then(setQualification)
      .catch(() => toast.error("Research completed, but the score could not be refreshed"));
  }, [research.final, fetchPersona, fetchAccount, prospectId]);
  useEffect(() => { if (research.error) toast.error(research.error); }, [research.error]);

  // Fetch qualification
  useEffect(() => {
    async function fetchQualification() {
      if (!prospectId) return;

      setQualificationLoading(true);
      try {
        const response = await fetch(`/api/outreach/prospects/${prospectId}/qualify`);
        if (!response.ok) throw new Error("Failed to fetch qualification");

        const data = await response.json();
        setQualification(data);
      } catch (error) {
        console.error("Error fetching qualification:", error);
        toast.error("Could not load qualification — refresh to try again");
      } finally {
        setQualificationLoading(false);
      }
    }
    fetchQualification();
  }, [prospectId]);

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

  const handleGenerateOutreach = async (medium: OutreachMedium, targetContentValue?: string) => {
    setIsGeneratingOutreach(true);
    try {
      const body: { medium: OutreachMedium; generate: boolean; targetContent?: string } = {
        medium,
        generate: true,
      };
      if (targetContentValue) {
        body.targetContent = targetContentValue;
      }

      const response = await fetch(`/api/outreach/prospects/${prospectId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error || "Failed to generate outreach");
      }

      const result = await response.json() as OutreachMessage;
      setOutreachMessages((current) => [
        result,
        ...current.filter(({ id }) => id !== result.id),
      ]);
      toast.success("Outreach draft ready");

      setContentCommentDialogOpen(false);
      setTargetContent("");
    } catch (error) {
      console.error("Failed to generate outreach:", error);
      toast.error(error instanceof Error ? error.message : "Could not generate outreach — try again");
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleToggleMessageStatus = async (message: OutreachMessage) => {
    const newStatus = message.status === "draft" ? "sent" : "draft";
    try {
      const response = await fetch(`/api/outreach/prospects/${prospectId}/outreach/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update message status");

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
      toast.error("Could not update the message status — try again");
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

  return (
    <div className="w-full min-w-0 space-y-8">
      {/* Detail page top: back link + hero (PageHeader-equivalent) */}
      <div>
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/prospects"
        >
          <ArrowLeft className="size-4" /> Prospects
        </Link>
        <ProspectHero
          prospect={prospect}
          callRecordingUrl={callRecordingProspectUrl(prospect.id)}
          isGeneratingOutreach={isGeneratingOutreach}
          isDeleting={isDeleting}
          updatingStatus={updatingStatus}
          onStatusChange={handleStatusChange}
          onGenerateOutreach={handleGenerateOutreach}
          onOpenCommentDialog={() => setContentCommentDialogOpen(true)}
          onDelete={() => setConfirmDelete({ type: "prospect" })}
          researchButton={
            <Button
              aria-label="Research this person"
              disabled={research.isStreaming}
              onClick={() => research.start()}
              size="sm"
            >
              {research.isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="hidden sm:inline">{research.isStreaming ? "Researching…" : "Research"}</span>
            </Button>
          }
          nurtureAction={nurtureFunnels ? (
            <Button aria-label="Add to funnel" size="sm" variant="outline" onClick={openNurtureDialog}>
              <GitBranch className="h-4 w-4" />
              <span className="hidden sm:inline">Add to funnel</span>
            </Button>
          ) : undefined}
        />
      </div>

      <CompanySummaryBar
        account={account}
        companyName={prospect.company || undefined}
        isLoading={accountLoading}
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
            {(research.isStreaming || research.dimensions.length > 0) && (
              <Card className={research.isStreaming ? "border-primary/20 shadow-sm" : undefined}>
                <CardHeader>
                  <CardTitle>Live research</CardTitle>
                </CardHeader>
                <CardContent>
                  <DimensionResearchSurface
                    entityName={prospect.name}
                    dimensions={research.dimensions}
                    isStreaming={research.isStreaming}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>Persona fit</CardTitle>
                  {persona?.personaScore != null && (
                    <Badge variant="outline" className="text-xs tabular-nums">
                      {Math.round(persona.personaScore)}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={research.isStreaming}
                  onClick={() => research.start()}
                >
                  <Search className="h-4 w-4" />
                  {persona && persona.dimensions.length > 0 ? "Re-research" : "Research"}
                </Button>
              </CardHeader>
              <CardContent>
                {personaLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : persona && persona.dimensions.length > 0 ? (
                  <div className="space-y-5">
                    <div className="flex justify-center">
                      <ScoreRing score={persona.personaScore == null ? null : Math.round(persona.personaScore)} label="Persona" />
                    </div>
                    <div className="space-y-4">
                      {persona.dimensions.map((dimension) => {
                        const percent = Math.round((dimension.effectiveMatch ?? 0) * 100);
                        return (
                          <div key={dimension.dimensionKey} className="space-y-1.5 border-t pt-4 first:border-t-0 first:pt-0">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="font-medium capitalize">
                                {formatDimensionKey(dimension.dimensionKey)}
                                {dimension.hardExclusion && (
                                  <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-destructive" />
                                )}
                              </span>
                              <span className="tabular-nums text-muted-foreground">{percent}%</span>
                            </div>
                            {dimension.observedValue && (
                              <p className="text-sm leading-6 text-muted-foreground">{dimension.observedValue}</p>
                            )}
                            {dimension.evidence.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-0.5">
                                {[...new Set(dimension.evidence)].slice(0, 4).map((url) => (
                                  <a
                                    key={url}
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                                    href={url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    <ExternalLink className="size-3" />
                                    {hostname(url)}
                                  </a>
                                ))}
                              </div>
                            )}
                            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full transition-all duration-500 ${dimension.hardExclusion ? "bg-destructive" : "bg-chart-2"}`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <div className="rounded-full border bg-muted/40 p-3">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Not researched yet — run Research.</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Research gathers live evidence for each persona dimension and scores the fit.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4">
                <QuickInfo prospect={prospect} />
                <QualificationCard
                  qualification={qualification?.prospect ?? null}
                  legacy={qualification?.legacy ?? null}
                  isLoading={qualificationLoading}
                  onRequalify={() => qualifyStream.start()}
                  live={{
                    reasoning: qualifyStream.reasoning,
                    isStreaming: qualifyStream.isStreaming,
                  }}
                />
              </div>

              <div className="space-y-4 lg:col-span-2">
                <NextActionCard
                  items={actionItems}
                  isLoading={actionItemsLoading}
                  onComplete={handleCompleteActionItem}
                  onSnooze={handleSnoozeActionItem}
                  onCreate={handleCreateActionItem}
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

                <OutreachHistory
                  messages={outreachMessages}
                  isLoading={outreachLoading}
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
