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
import { useActionStream } from "@/hooks/use-action-stream";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, use } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, ExternalLink, FolderKanban, Loader2, Pencil, Trash2, RefreshCw } from "lucide-react";
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
  const entitiesStream = useActionStream<{
    entities?: Array<{ name: string; type: string }>;
  }, { entityCount: number }>({ api: `/api/content/projects/${projectId}/ingest/stream` });
  const isReingesting = entitiesStream.isStreaming;

  useEffect(() => {
    async function fetchProject() {
      try {
        const response = await fetch(`/api/content/projects/${routeProjectId}`);
        if (!response.ok) throw new Error('Failed to fetch project');

        const data = await response.json();
        setProject(data);
      } catch (error) {
        console.error('Error fetching project:', error);
        toast.error("Could not load the project. Refresh to try again.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchProject();
  }, [routeProjectId]);

  useEffect(() => {
    async function fetchEntities() {
      if (!projectId) return;

      setEntitiesLoading(true);
      try {
        const response = await fetch(`/api/content/projects/${projectId}/entities`);
        if (!response.ok) throw new Error('Failed to fetch entities');

        const data = await response.json();
        setEntities(data);
      } catch (error) {
        console.error('Error fetching entities:', error);
        toast.error("Could not load extracted entities. Refresh to try again.");
      } finally {
        setEntitiesLoading(false);
      }
    }
    fetchEntities();
  }, [projectId]);

  const handleReingest = () => entitiesStream.start();

  useEffect(() => {
    if (!entitiesStream.final || !projectId) return;
    void fetch(`/api/content/projects/${projectId}/entities`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to fetch entities')))
      .then(setEntities)
      .catch(() => toast.error("Extraction completed, but entities could not be refreshed."));
  }, [entitiesStream.final, projectId]);
  useEffect(() => { if (entitiesStream.error) toast.error(entitiesStream.error); }, [entitiesStream.error]);

  const handleDelete = async () => {
    if (!project) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/content/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete');

      toast.success("Project deleted");
      router.push('/content/projects');
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error("Could not delete the project. Try again.");
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
            {entitiesStream.isStreaming || entitiesStream.partial ? (
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
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedEntities).map(([type, entityList]) => (
                  <div key={type}>
                    <h3 className="mb-2 text-sm font-medium">{type}s</h3>
                    <div className="flex flex-wrap gap-2">
                      {entityList.map((entity, i) => (
                        <Badge key={i} variant="outline">
                          {entity.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
