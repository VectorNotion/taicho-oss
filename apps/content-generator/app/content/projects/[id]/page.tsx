"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { PageHeader } from "@/components/PageHeader";
import { EntityChipStream, ReasoningTicker, StreamSection } from "@/components/genui";
import { useCapabilityStream } from "@content-automation/ui/hooks/use-capability-stream";
import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, use, useCallback } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, CircleAlert, ExternalLink, FolderKanban, Loader2, Pencil, Trash2, RefreshCw } from "lucide-react";
import type { ProjectEntity } from "@/products/content-generator/data/project-repository";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: routeProjectId } = use(params);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [projectId] = useState(routeProjectId);
  const [project, setProject] = useState<any>(null);
  const [entities, setEntities] = useState<ProjectEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [entitiesLoadError, setEntitiesLoadError] = useState<string | null>(null);
  const entitiesStream = useCapabilityStream<{
    entities?: Array<{ name: string; type: string }>;
  }, { entityCount: number }>({ api: `/content/projects/${projectId}/ingest` });
  const isReingesting = entitiesStream.isStreaming;

  useEffect(() => {
    async function fetchProject() {
      try {
        const data = await apiGet<{ project: any }>(`/content/projects/${routeProjectId}`);
        setProject(data.project);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          console.error('Error fetching project:', error);
          toast.error("Could not load the project. Refresh to try again.");
        }
      } finally {
        setIsLoading(false);
      }
    }
    fetchProject();
  }, [routeProjectId]);

  const fetchEntities = useCallback(async () => {
    if (!projectId) return;

    setEntitiesLoading(true);
    setEntitiesLoadError(null);
    try {
      const data = await apiGet<{ entities: ProjectEntity[] }>(`/content/projects/${projectId}/entities`);
      setEntities(data.entities);
    } catch (error) {
      console.error('Error fetching entities:', error);
      setEntitiesLoadError(error instanceof Error ? error.message : "Could not load extracted entities.");
    } finally {
      setEntitiesLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void fetchEntities(); }, [fetchEntities]);

  const handleReingest = () => entitiesStream.start();

  useEffect(() => {
    if (!entitiesStream.final || !projectId) return;
    void fetchEntities();
  }, [entitiesStream.final, fetchEntities, projectId]);
  useEffect(() => { if (entitiesStream.error) toast.error(entitiesStream.error); }, [entitiesStream.error]);

  const handleDelete = async () => {
    if (!project) return;

    setIsDeleting(true);
    try {
      await apiMutate("DELETE", `/content/projects/${projectId}`, { confirm: true });

      toast.success("Project deleted");
      router.push('/content/projects');
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error(error instanceof ApiError
        ? error.message
        : "Could not delete the project. Try again.");
      setIsDeleting(false);
    }
  };

  // Group entities by type
  const groupedEntities = entities.reduce((acc, entity) => {
    if (!acc[entity.type]) {
      acc[entity.type] = [];
    }
    acc[entity.type].push(entity);
    return acc;
  }, {} as Record<string, ProjectEntity[]>);

  const entityTypeLabel = (type: string) => type
    .replace(/^content\./, '')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());

  const extractedEntityList = entities.length > 0 ? (
    <div className="space-y-5" data-testid="stored-project-entities">
      {Object.entries(groupedEntities).map(([type, entityList]) => (
        <section aria-labelledby={`entity-type-${type}`} key={type}>
          <h3 className="mb-2 text-sm font-medium" id={`entity-type-${type}`}>{entityTypeLabel(type)}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {entityList.map((entity) => (
              <div className="rounded-lg border bg-muted/20 p-3" data-claim-id={entity.claimId ?? undefined} data-entity-id={entity.entityId} key={entity.entityId}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{entity.name}</p>
                  <Badge variant="outline">{entityTypeLabel(entity.type)}</Badge>
                </div>
                {entity.statement && <p className="mt-2 text-sm text-muted-foreground">{entity.statement}</p>}
                {entity.evidence && (
                  <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground/80">
                      Source: {entity.evidence.source?.title ?? "Project description"}
                    </p>
                    <p className="mt-1 line-clamp-3">{entity.evidence.excerpt}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  ) : null;

  const backLink = (
    <Link
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      href="/content/projects"
    >
      <ArrowLeft className="size-4" /> All projects
    </Link>
  );

  if (isLoading) {
    return (
      <div className="w-full min-w-0">
        {backLink}
        <div className="mb-8">
          <Skeleton className="h-9 w-full max-w-sm" />
        </div>
        <div className="space-y-8">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="w-full min-w-0">
        {backLink}
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderKanban className="mb-4 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This project doesn't exist or was removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const resources = [
    { label: "Demo", url: project.demoUrl },
    { label: "GitHub repository", url: project.githubUrl },
    { label: "Live site", url: project.liveUrl },
    { label: "Documentation", url: project.docsUrl },
  ].filter(
    (resource): resource is { label: string; url: string } =>
      Boolean(resource.url),
  );

  return (
    <div className="w-full min-w-0">
      {backLink}
      <PageHeader
        title={project.title}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/content/projects/${projectId}/edit`}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      />

      {/* Main Content */}
      <div className="space-y-8">
        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Project details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="text-sm font-medium" title={new Date(project.createdAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last updated</p>
                <p className="text-sm font-medium" title={new Date(project.updatedAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag: string) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Description */}
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{project.description}</p>
          </CardContent>
        </Card>

        {/* Links & Resources */}
        {resources.length > 0 && (
          <ListCard
            description="Demos, repositories, and documentation for this project."
            title="Links and resources"
          >
            <ListRows>
              {resources.map((resource) => (
                <ListRow
                  actions={[
                    {
                      external: true,
                      href: resource.url,
                      icon: ExternalLink,
                      label: `Open ${resource.label.toLowerCase()}`,
                    },
                  ]}
                  external
                  href={resource.url}
                  key={resource.label}
                  meta={[resource.url]}
                  title={resource.label}
                />
              ))}
            </ListRows>
          </ListCard>
        )}

        {/* Extracted Entities */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Extracted entities</CardTitle>
                <CardDescription>
                  Automatically extracted from the project description
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReingest}
                disabled={isReingesting}
              >
                {isReingesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isReingesting ? "Extracting..." : "Re-extract"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {entitiesStream.error ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert">
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Entity extraction failed</p>
                      <p className="mt-1 text-sm text-muted-foreground">{entitiesStream.error}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entities.length > 0 ? "Previously stored entities were not changed." : "No entities were stored."}
                      </p>
                      <Button className="mt-3" onClick={handleReingest} size="sm" variant="outline">
                        <RefreshCw className="size-4" /> Try extraction again
                      </Button>
                    </div>
                  </div>
                </div>
                {extractedEntityList}
              </div>
            ) : entitiesStream.isStreaming ? (
              <div className="space-y-4">
                <ReasoningTicker text={entitiesStream.reasoning} active={entitiesStream.isStreaming} />
                <StreamSection title="Extracting entities" state={entitiesStream.isStreaming ? "streaming" : "done"}>
                  <EntityChipStream entities={(entitiesStream.partial?.entities ?? []).filter((entity) => entity?.name && entity?.type)} />
                </StreamSection>
              </div>
            ) : entitiesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
            ) : entitiesLoadError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert">
                <p className="text-sm font-medium">Extracted entities could not be loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">{entitiesLoadError}</p>
                <Button className="mt-3" onClick={() => void fetchEntities()} size="sm" variant="outline">
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </div>
            ) : entities.length === 0 ? (
              <div className="py-6 text-center">
                <p className="mb-3 text-sm text-muted-foreground">
                  Entities extracted from the description appear here.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReingest}
                  disabled={isReingesting}
                >
                  {isReingesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Extract entities
                </Button>
              </div>
            ) : extractedEntityList}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This permanently deletes &ldquo;{project.title}&rdquo; and its extracted entities.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteDialogOpen(false);
                handleDelete();
              }}
              disabled={isDeleting}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
