"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";

interface ProjectFormData {
  title: string;
  description: string;
  tags: string[];
  demoUrl: string;
  githubUrl: string;
  liveUrl: string;
  docsUrl: string;
}

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTag, setCurrentTag] = useState("");
  const [projectId, setProjectId] = useState<string>("");

  const [formData, setFormData] = useState<ProjectFormData>({
    title: "",
    description: "",
    tags: [],
    demoUrl: "",
    githubUrl: "",
    liveUrl: "",
    docsUrl: "",
  });

  useEffect(() => {
    async function fetchProject() {
      try {
        const resolvedParams = await params;
        setProjectId(resolvedParams.id);

        const response = await fetch(`/api/content/projects/${resolvedParams.id}`);
        if (!response.ok) throw new Error('Failed to fetch project');

        const project = await response.json();
        setFormData({
          title: project.title,
          description: project.description,
          tags: project.tags,
          demoUrl: project.demoUrl || "",
          githubUrl: project.githubUrl || "",
          liveUrl: project.liveUrl || "",
          docsUrl: project.docsUrl || "",
        });
      } catch (error) {
        console.error("Error fetching project:", error);
        toast.error("Could not load the project. Refresh to try again.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchProject();
  }, [params]);

  const handleAddTag = () => {
    if (currentTag.trim() && !formData.tags.includes(currentTag.trim())) {
      setFormData({
        ...formData,
        tags: [...formData.tags, currentTag.trim()],
      });
      setCurrentTag("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((tag) => tag !== tagToRemove),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/content/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to update project');

      toast.success("Project updated");
      router.push("/content/projects");
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Could not update the project. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <Skeleton className="h-9 w-full max-w-xs" />
        </div>
        <div className="space-y-8">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      {backLink}
      <PageHeader title="Edit project" description="Update project details" />

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
            <CardDescription>Core details about your project</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="title">
                Project title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Enter project title..."
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Describe what this project is about..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="min-h-[150px] resize-none"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  placeholder="Add a tag..."
                  value={currentTag}
                  onChange={(e) => setCurrentTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleAddTag}
                  aria-label="Add tag"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {formData.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {formData.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-4 p-0 hover:bg-transparent hover:text-destructive"
                        onClick={() => handleRemoveTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
            <CardDescription>Add relevant links to demos, repositories, and documentation</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="demoUrl">Demo URL</Label>
              <Input
                id="demoUrl"
                type="url"
                placeholder="https://demo.example.com"
                value={formData.demoUrl}
                onChange={(e) => setFormData({ ...formData, demoUrl: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="githubUrl">GitHub repository</Label>
              <Input
                id="githubUrl"
                type="url"
                placeholder="https://github.com/username/repo"
                value={formData.githubUrl}
                onChange={(e) => setFormData({ ...formData, githubUrl: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="liveUrl">Live site</Label>
              <Input
                id="liveUrl"
                type="url"
                placeholder="https://project.example.com"
                value={formData.liveUrl}
                onChange={(e) => setFormData({ ...formData, liveUrl: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="docsUrl">Documentation</Label>
              <Input
                id="docsUrl"
                type="url"
                placeholder="https://docs.example.com"
                value={formData.docsUrl}
                onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/content/projects")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
