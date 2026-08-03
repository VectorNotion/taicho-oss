"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Plus, X, Upload, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";

interface ProjectFormData {
  title: string;
  description: string;
  tags: string[];
  demoUrl: string;
  githubUrl: string;
  liveUrl: string;
  docsUrl: string;
  screenshots: File[];
}

export default function NewProjectPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTag, setCurrentTag] = useState("");
  const [ingestionStatus, setIngestionStatus] = useState<'idle' | 'ingesting' | 'success' | 'error'>('idle');

  const [formData, setFormData] = useState<ProjectFormData>({
    title: "",
    description: "",
    tags: [],
    demoUrl: "",
    githubUrl: "",
    liveUrl: "",
    docsUrl: "",
    screenshots: [],
  });

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFormData({
        ...formData,
        screenshots: Array.from(e.target.files),
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Step 1: Create project in Neo4j
      const response = await fetch('/api/content/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          tags: formData.tags,
          demoUrl: formData.demoUrl,
          githubUrl: formData.githubUrl,
          liveUrl: formData.liveUrl,
          docsUrl: formData.docsUrl,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create project');
      }

      const project = await response.json();

      // Step 2: Run automatic entity extraction.
      setIngestionStatus('ingesting');
      try {
        const ingestionResponse = await fetch(`/api/content/projects/${project.id}/ingest`, {
          method: 'POST',
        });

        if (!ingestionResponse.ok) {
          throw new Error('Ingestion request failed');
        }

        await ingestionResponse.json();
        setIngestionStatus('success');
        toast.success("Project created and entity extraction completed.");
      } catch (ingestionError) {
        console.error('Failed to start extraction:', ingestionError);
        setIngestionStatus('error');
        toast.error("Project created, but entity extraction failed. Retry from the project page.");
      }

      // Step 3: Navigate to project detail page
      setTimeout(() => {
        router.push(`/content/projects/${project.id}`);
      }, 1000);
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Could not create the project. Try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full min-w-0">
      <Link
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        href="/content/projects"
      >
        <ArrowLeft className="size-4" /> All projects
      </Link>
      <PageHeader
        title="New project"
        description="Add a project to your content portfolio"
      />

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
            <CardDescription>
              Core details about your project
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="title">
                Project title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Enter project title..."
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                required
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Describe what this project is about, key features, and your role..."
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="min-h-[150px] resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                Provide a comprehensive overview of the project
              </p>
            </div>

            {/* Tags */}
            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  placeholder="Add a tag (e.g., React, AI, Web3)..."
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

        {/* Links & URLs */}
        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
            <CardDescription>
              Add relevant links to demos, repositories, and documentation
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {/* Demo URL */}
            <div className="grid gap-2">
              <Label htmlFor="demoUrl">Demo URL</Label>
              <Input
                id="demoUrl"
                type="url"
                placeholder="https://demo.example.com"
                value={formData.demoUrl}
                onChange={(e) =>
                  setFormData({ ...formData, demoUrl: e.target.value })
                }
              />
            </div>

            {/* GitHub URL */}
            <div className="grid gap-2">
              <Label htmlFor="githubUrl">GitHub repository</Label>
              <Input
                id="githubUrl"
                type="url"
                placeholder="https://github.com/username/repo"
                value={formData.githubUrl}
                onChange={(e) =>
                  setFormData({ ...formData, githubUrl: e.target.value })
                }
              />
            </div>

            {/* Live URL */}
            <div className="grid gap-2">
              <Label htmlFor="liveUrl">Live site</Label>
              <Input
                id="liveUrl"
                type="url"
                placeholder="https://project.example.com"
                value={formData.liveUrl}
                onChange={(e) =>
                  setFormData({ ...formData, liveUrl: e.target.value })
                }
              />
            </div>

            {/* Documentation URL */}
            <div className="grid gap-2">
              <Label htmlFor="docsUrl">Documentation</Label>
              <Input
                id="docsUrl"
                type="url"
                placeholder="https://docs.example.com"
                value={formData.docsUrl}
                onChange={(e) =>
                  setFormData({ ...formData, docsUrl: e.target.value })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Media */}
        <Card>
          <CardHeader>
            <CardTitle>Media</CardTitle>
            <CardDescription>
              Upload screenshots, images, or videos showcasing your project
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="screenshots">Screenshots and images</Label>
              <div className="rounded-lg border-2 border-dashed p-6 text-center">
                <div className="space-y-3">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="mb-2 text-sm text-muted-foreground">
                      Drag and drop your files here, or click to browse
                    </p>
                    <Input
                      id="screenshots"
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      onChange={handleFileChange}
                      className="mx-auto max-w-xs"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Supported formats: PNG, JPG, GIF, MP4, MOV (max 10MB each)
                  </p>
                </div>
              </div>
              {formData.screenshots.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-sm font-medium">
                    Selected files: {formData.screenshots.length}
                  </p>
                  <div className="space-y-1">
                    {formData.screenshots.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="text-xs">
                          ({(file.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/content/projects")}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting
              ? (ingestionStatus === 'ingesting'
                ? "Extracting entities..."
                : "Creating project...")
              : "Create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
