"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FolderKanban, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { ApiError, apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import { StatRow } from "@/components/StatRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Context-only nodes - no performance tracking
const KIND_LABELS: Record<string, string> = {
  project: "Project",
  product: "Product",
  service: "Service",
};

export type Project = {
  id: string;
  title: string;
  description: string;
  kind?: string;
  tags: string[];
  createdAt: string;
  entityCount?: number;
  processed?: boolean;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: Project[] }>('/content/projects', { limit: 100 });
      setProjects(data.items);
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error("Could not load projects. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const filteredProjects = projects.filter((project) => {
    const matchesKind = kindFilter === "all" || (project.kind ?? "project") === kindFilter;
    const matchesSearch =
      project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesKind && matchesSearch;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      await apiMutate("DELETE", `/content/projects/${deleteTarget.id}`, { confirm: true });

      toast.success("Project deleted");
      setDeleteTarget(null);
      fetchProjects();
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error(error instanceof ApiError
        ? error.message
        : "Could not delete the project. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Projects"
        description="What you're building that informs content creation"
        actions={
          <Button asChild>
            <Link href="/content/new/project">
              <Plus className="h-4 w-4" />
              New project
            </Link>
          </Button>
        }
      />

      <div className="space-y-8">
        <StatRow
          isLoading={loading}
          stats={[{
            featured: true,
            label: "Total projects",
            value: projects.length.toLocaleString(),
          }]}
        />

        {/* Projects list */}
        <ListSurface
          count={filteredProjects.length}
          description="The work that gives your content context."
          emptyState={
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <FolderKanban className="mb-4 h-8 w-8 text-muted-foreground" />
              <p className="mb-4 text-sm text-muted-foreground">
                {searchQuery
                  ? `No projects match “${searchQuery}”.`
                  : "Projects you're building inform content creation."}
              </p>
              {searchQuery ? (
                <Button variant="outline" onClick={() => setSearchQuery("")}>
                  Clear search
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <Link href="/content/new/project">
                    <Plus className="h-4 w-4" />
                    New project
                  </Link>
                </Button>
              )}
            </div>
          }
          filters={
            <FilterSelect
              label="Type"
              onValueChange={setKindFilter}
              options={[
                { label: "All types", value: "all" },
                { label: "Projects", value: "project" },
                { label: "Products", value: "product" },
                { label: "Services", value: "service" },
              ]}
              value={kindFilter}
            />
          }
          isLoading={loading}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search projects…"
          searchValue={searchQuery}
          title="Projects"
        >
          {!loading && filteredProjects.length > 0 ? (
            <ListRows>
              {filteredProjects.map((project) => (
                <ListRow
                  actions={[
                    {
                      href: `/content/projects/${project.id}/edit`,
                      icon: Pencil,
                      label: `Edit ${project.title}`,
                    },
                    {
                      destructive: true,
                      icon: Trash2,
                      label: `Delete ${project.title}`,
                      onSelect: () => setDeleteTarget(project),
                    },
                  ]}
                  badge={
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline">{KIND_LABELS[project.kind ?? "project"] ?? project.kind}</Badge>
                      <Badge variant={project.processed ? "default" : "secondary"}>
                        {project.processed ? "Processed" : "Not processed"}
                      </Badge>
                    </span>
                  }
                  href={`/content/projects/${project.id}`}
                  key={project.id}
                  leading={
                    <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                      <FolderKanban className="size-4" />
                    </span>
                  }
                  meta={[
                    project.description,
                    project.tags.length > 0 ? project.tags.join(", ") : "No tags",
                    `${project.entityCount ?? 0} ${(project.entityCount ?? 0) === 1 ? "entity" : "entities"}`,
                    <span key="created" title={new Date(project.createdAt).toLocaleString()}>
                      {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                    </span>,
                  ]}
                  title={project.title}
                />
              ))}
            </ListRows>
          ) : null}
        </ListSurface>
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This permanently deletes &ldquo;{deleteTarget?.title}&rdquo; and its extracted
              entities. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
