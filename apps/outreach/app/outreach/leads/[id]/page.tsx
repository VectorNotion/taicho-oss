"use client";

import { useState, useEffect, use } from "react";
import { toast } from "sonner";
import { ArrowLeft, GitBranch, Loader2, Search, UserX } from "lucide-react";
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
import { ResearchMastra } from "@/components/leads/research-mastra";

import { LeadHero, QuickInfo, ResearchSection, OutreachHistory, ActivityTimeline, AddActivityDialog, LeadNotes, type Activity } from "@/components/leads";
import { QualificationCard } from "@/components/leads/QualificationCard";
import { useActionStream } from "@/hooks/use-action-stream";
import { ResearchSectionSkeleton } from "@/components/leads/ResearchSkeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeadResearchResult } from "@/products/outreach/domain/research-schema";
import type {
  Lead,
  LeadNote,
  LeadStatus,
  LeadQualification,
  OutreachMessage,
  OutreachMedium,
  LeadResearch,
  LeadActivity,
} from "@/products/outreach/domain/types";

type ConfirmDelete =
  | { type: "lead" }
  | { type: "activity"; id: string }
  | { type: "message"; id: string };

type NurtureFunnel = { id: string; name: string; openEnded?: boolean };

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: routeLeadId } = use(params);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [leadId] = useState(routeLeadId);
  const [lead, setLead] = useState<Lead | null>(null);
  const [outreachMessages, setOutreachMessages] = useState<OutreachMessage[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(true);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [contentCommentDialogOpen, setContentCommentDialogOpen] = useState(false);
  const [targetContent, setTargetContent] = useState("");
  const [addActivityDialogOpen, setAddActivityDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [research, setResearch] = useState<LeadResearch | null>(null);
  const [researchLoading, setResearchLoading] = useState(true);
  const [isResearchStreaming, setIsResearchStreaming] = useState(false);
  const [qualification, setQualification] = useState<LeadQualification | null>(null);
  const [qualificationLoading, setQualificationLoading] = useState(true);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [isSubmittingActivity, setIsSubmittingActivity] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nurtureFunnels, setNurtureFunnels] = useState<NurtureFunnel[] | null>(null);
  const [nurtureDialogOpen, setNurtureDialogOpen] = useState(false);
  const [selectedFunnelId, setSelectedFunnelId] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const qualifyStream = useActionStream<{ score?: number; notes?: string }, { score?: number }>({
    api: `/api/outreach/leads/${leadId}/qualify/stream`,
  });

  // Fetch lead data
  useEffect(() => {
    async function fetchLead() {
      try {
        const response = await fetch(`/api/outreach/leads/${routeLeadId}`);
        if (!response.ok) throw new Error("Failed to fetch lead");

        const data = await response.json();
        setLead(data);
      } catch (error) {
        console.error("Error fetching lead:", error);
        toast.error("Could not load this person — refresh to try again");
      } finally {
        setIsLoading(false);
      }
    }
    fetchLead();
  }, [routeLeadId]);

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
      if (!leadId) return;

      setOutreachLoading(true);
      try {
        const response = await fetch(`/api/outreach/leads/${leadId}/outreach`);
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
  }, [leadId]);

  useEffect(() => {
    if (!qualifyStream.final || !leadId) return;
    void fetch(`/api/outreach/leads/${leadId}/qualify`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to fetch qualification')))
      .then(setQualification)
      .catch(() => toast.error("Qualification completed, but the result could not be refreshed"));
  }, [qualifyStream.final, leadId]);
  useEffect(() => { if (qualifyStream.error) toast.error(qualifyStream.error); }, [qualifyStream.error]);

  // Fetch research data
  useEffect(() => {
    async function fetchResearch() {
      if (!leadId) return;

      setResearchLoading(true);
      try {
        const response = await fetch(`/api/outreach/leads/${leadId}/research`);
        if (!response.ok) throw new Error("Failed to fetch research");

        const data = await response.json();
        setResearch(data);
      } catch (error) {
        console.error("Error fetching research:", error);
        toast.error("Could not load research — refresh to try again");
      } finally {
        setResearchLoading(false);
      }
    }
    fetchResearch();
  }, [leadId]);

  // Fetch qualification
  useEffect(() => {
    async function fetchQualification() {
      if (!leadId) return;

      setQualificationLoading(true);
      try {
        const response = await fetch(`/api/outreach/leads/${leadId}/qualify`);
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
  }, [leadId]);

  // Fetch notes
  useEffect(() => {
    async function fetchNotes() {
      if (!leadId) return;

      setNotesLoading(true);
      try {
        const response = await fetch(`/api/outreach/leads/${leadId}/notes`);
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
  }, [leadId]);

  // Fetch activities
  useEffect(() => {
    async function fetchActivities() {
      if (!leadId) return;

      setActivitiesLoading(true);
      try {
        const response = await fetch(`/api/outreach/leads/${leadId}/activities`);
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
  }, [leadId]);

  const handleAddNote = async (content: string) => {
    const response = await fetch(`/api/outreach/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) throw new Error("Failed to add note");

    const newNote = await response.json();
    setNotes((prev) => [newNote, ...prev]);
  };

  const handleDeleteNote = async (noteId: string) => {
    const response = await fetch(`/api/outreach/leads/${leadId}/notes/${noteId}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete note");

    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleAddActivity = async (data: Omit<Activity, "id" | "createdAt" | "leadId">) => {
    setIsSubmittingActivity(true);
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}/activities`, {
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
    } catch (error) {
      console.error("Error adding activity:", error);
      toast.error("Could not add the activity — try again");
    } finally {
      setIsSubmittingActivity(false);
    }
  };

  const handleUpdateActivity = async (data: Omit<Activity, "id" | "createdAt" | "leadId">) => {
    if (!editingActivity) return;

    setIsSubmittingActivity(true);
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}/activities/${editingActivity.id}`, {
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
      const response = await fetch(`/api/outreach/leads/${leadId}/activities/${activityId}`, {
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

  const handleStatusChange = async (newStatus: LeadStatus) => {
    if (!lead) return;

    setUpdatingStatus(true);
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update status");

      const updated = await response.json();
      setLead(updated);
      toast.success("Status updated");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Could not update the status — try again");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleResearchStarted = () => {
    setIsResearchStreaming(true);
  };

  const handleResearchComplete = async (result: LeadResearchResult) => {
    setIsResearchStreaming(false);

    // Update research state with the streamed result
    // Convert LeadResearchResult to LeadResearch format
    const researchData: LeadResearch = {
      leadId,
      industry: result.industry,
      companySummary: result.companySummary,
      talkingPoints: result.talkingPoints,
      outreachAngle: result.outreachAngle,
      companyInsights: result.companyInsights.map((insight, idx) => ({
        id: `insight-${idx}`,
        category: insight.category,
        content: insight.content,
        sourceUrl: insight.sourceUrl,
        createdAt: new Date().toISOString(),
      })),
      competitors: result.competitors.map((comp, idx) => ({
        id: `competitor-${idx}`,
        name: comp.name,
        relevance: comp.relevance,
        aiFocus: comp.aiFocus,
        createdAt: new Date().toISOString(),
      })),
      updatedAt: new Date().toISOString(),
    };
    setResearch(researchData);

    // Refresh qualification data after research completes
    try {
      const qualifyResponse = await fetch(`/api/outreach/leads/${leadId}/qualify`);
      if (qualifyResponse.ok) {
        const qualifyData = await qualifyResponse.json();
        if (qualifyData) {
          setQualification(qualifyData);
        }
      }
    } catch (error) {
      console.error("Failed to refresh qualification data:", error);
      toast.error("Could not refresh qualification — reload to see the latest score");
    }
  };

  const handleResearchError = (error: string) => {
    setIsResearchStreaming(false);
    console.error("Research failed:", error);
    toast.error("Research failed — try again");
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

      const response = await fetch(`/api/outreach/leads/${leadId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error("Failed to start outreach generation");

      const result = await response.json();
      toast.success(result.message || "Outreach generation started — refresh to see results when it completes");

      setContentCommentDialogOpen(false);
      setTargetContent("");
    } catch (error) {
      console.error("Failed to generate outreach:", error);
      toast.error("Could not generate outreach — try again");
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleToggleMessageStatus = async (message: OutreachMessage) => {
    const newStatus = message.status === "draft" ? "sent" : "draft";
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}/outreach/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update message status");

      const updated = await response.json();
      setOutreachMessages((prev) =>
        prev.map((m) => (m.id === message.id ? updated : m))
      );
      toast.success(newStatus === "sent" ? "Message marked as sent externally" : "Message moved back to drafts");
    } catch (error) {
      console.error("Error updating message status:", error);
      toast.error("Could not update the message status — try again");
    }
  };

  const openNurtureDialog = () => {
    setEnrollEmail(lead?.email ?? "");
    setSelectedFunnelId(nurtureFunnels?.[0]?.id ?? "");
    setNurtureDialogOpen(true);
  };

  const handleEnrollInNurture = async () => {
    if (!lead || !selectedFunnelId || !enrollEmail.includes("@")) return;
    const funnel = nurtureFunnels?.find((item) => item.id === selectedFunnelId);
    setIsEnrolling(true);
    try {
      const response = await fetch(`/api/cascade/funnels/${selectedFunnelId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: enrollEmail.trim(),
          workspaceContactId: lead.id,
          attributes: {
            name: lead.name,
            company: lead.company,
            title: lead.title,
            leadStatus: lead.status,
            source: "outreach",
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not enroll this person");

      if (lead.email !== enrollEmail.trim()) {
        const updateResponse = await fetch(`/api/outreach/leads/${lead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: enrollEmail.trim() }),
        });
        if (updateResponse.ok) setLead(await updateResponse.json());
      }

      const activityResponse = await fetch(`/api/outreach/leads/${lead.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "nurture_enrolled",
          title: `Enrolled in ${funnel?.name ?? "nurture"}`,
          metadata: { funnelId: selectedFunnelId, funnelName: funnel?.name },
        }),
      });
      if (activityResponse.ok) {
        const activity = await activityResponse.json();
        setActivities((current) => [activity, ...current]);
      }

      toast.success(`${lead.name} enrolled in ${funnel?.name ?? "nurture"}`);
      setNurtureDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enroll this person");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}/outreach/${messageId}`, {
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
    if (!lead) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/outreach/leads/${leadId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast.success("Person removed from Outreach");
      router.push("/outreach/pipeline");
    } catch (error) {
      console.error("Error deleting lead:", error);
      toast.error("Could not remove the person from Outreach — try again");
      setIsDeleting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setConfirmBusy(true);
    try {
      if (confirmDelete.type === "lead") {
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
    confirmDelete?.type === "lead"
      ? {
          title: "Remove from Outreach",
          description: `This removes ${lead?.name ?? "this person"} from the Outreach pipeline. Their shared People record remains available to the workspace.`,
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

  if (!lead) {
    return (
      <div className="w-full min-w-0">
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <UserX className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This person is not currently in the Outreach pipeline
          </p>
          <Button variant="outline" asChild>
            <Link href="/outreach/pipeline">Back to pipeline</Link>
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
          href="/outreach/pipeline"
        >
          <ArrowLeft className="size-4" /> Pipeline
        </Link>
        <LeadHero
          lead={lead}
          isGeneratingOutreach={isGeneratingOutreach}
          isDeleting={isDeleting}
          updatingStatus={updatingStatus}
          onStatusChange={handleStatusChange}
          onGenerateOutreach={handleGenerateOutreach}
          onOpenCommentDialog={() => setContentCommentDialogOpen(true)}
          onDelete={() => setConfirmDelete({ type: "lead" })}
          researchButton={
            <ResearchMastra
              leadId={leadId}
              lead={{
                name: lead.name,
                company: lead.company || '',
                title: lead.title || '',
                location: lead.location || '',
              }}
              onStarted={handleResearchStarted}
              onComplete={handleResearchComplete}
              onError={handleResearchError}
            />
          }
          nurtureAction={nurtureFunnels ? (
            <Button aria-label="Enroll in nurture" size="sm" variant="outline" onClick={openNurtureDialog}>
              <GitBranch className="h-4 w-4" />
              <span className="hidden sm:inline">Enroll in nurture</span>
            </Button>
          ) : undefined}
        />
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left Column - Quick Info, Qualification & Research */}
        <div className="space-y-4">
          <QuickInfo lead={lead} />
          <QualificationCard
            qualification={qualification}
            isLoading={qualificationLoading}
            onRequalify={() => qualifyStream.start()}
            live={{
              score: qualifyStream.partial?.score ?? null,
              notes: qualifyStream.partial?.notes ?? "",
              reasoning: qualifyStream.reasoning,
              isStreaming: qualifyStream.isStreaming,
            }}
          />
          {/* Research section with Mastra streaming */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Research</CardTitle>
                {research && !isResearchStreaming && (
                  <Badge variant="outline" className="text-xs">
                    {research.industry}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Show skeleton while streaming research */}
              {isResearchStreaming && <ResearchSectionSkeleton />}

              {/* Show existing research if available and not streaming */}
              {!isResearchStreaming && research && !researchLoading && (
                <ResearchSection research={research} isLoading={false} inline />
              )}

              {/* Show empty state if no research and not streaming */}
              {!isResearchStreaming && !research && !researchLoading && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Search className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No research yet — run research to gather insights about this person
                  </p>
                </div>
              )}

              {/* Show loading state for initial page load */}
              {!isResearchStreaming && researchLoading && <ResearchSectionSkeleton />}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Activity, Notes & Outreach History */}
        <div className="space-y-4 lg:col-span-2">
          {/* Activity Timeline */}
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

          {/* About (LinkedIn bio) */}
          {lead.about && (
            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{lead.about}</p>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <LeadNotes
            notes={notes}
            isLoading={notesLoading}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
          />

          {/* Outreach History */}
          <OutreachHistory
            messages={outreachMessages}
            isLoading={outreachLoading}
            onToggleStatus={handleToggleMessageStatus}
            onDelete={(messageId) => setConfirmDelete({ type: "message", id: messageId })}
          />
        </div>
      </div>

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
            <DialogTitle>Enroll {lead.name} in nurture</DialogTitle>
            <DialogDescription>
              Choose the funnel that should start now. The same workspace Contact gains a Nurture role while remaining an Outreach target.
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
                <p className="text-xs text-muted-foreground">Create a funnel in Nurture before enrolling this person.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nurture-email">Email</Label>
              <Input id="nurture-email" type="email" value={enrollEmail} onChange={(event) => setEnrollEmail(event.target.value)} placeholder="person@company.com" />
              {!lead.email && <p className="text-xs text-muted-foreground">This email will also be saved on the shared People record.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNurtureDialogOpen(false)} disabled={isEnrolling}>Cancel</Button>
            <Button onClick={handleEnrollInNurture} disabled={isEnrolling || !selectedFunnelId || !enrollEmail.includes("@")}>
              {isEnrolling && <Loader2 className="h-4 w-4 animate-spin" />}
              Enroll contact
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
