"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MapPin,
  Pencil,
  Trash2,
  Search,
  Linkedin,
  Mail,
  MessageSquare,
  Loader2,
  ChevronDown,
  Sparkles,
  FileText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import type { Lead, LeadStatus, OutreachMedium } from "@/products/outreach/domain/types";
import { LEAD_STATUS_CONFIG, LEAD_PRIORITY_CONFIG } from "@/products/outreach/domain/types";

interface LeadHeroProps {
  lead: Lead;
  isGeneratingOutreach: boolean;
  isDeleting: boolean;
  updatingStatus: boolean;
  onStatusChange: (status: LeadStatus) => void;
  onGenerateOutreach: (medium: OutreachMedium) => void;
  onOpenCommentDialog: () => void;
  onDelete: () => void;
  /** Slot for custom research button (e.g., ResearchMastra component) */
  researchButton?: React.ReactNode;
  /** Optional cross-product action, present when Nurture is available. */
  nurtureAction?: React.ReactNode;
}

export function LeadHero({
  lead,
  isGeneratingOutreach,
  isDeleting,
  updatingStatus,
  onStatusChange,
  onGenerateOutreach,
  onOpenCommentDialog,
  onDelete,
  researchButton,
  nurtureAction,
}: LeadHeroProps) {
  const priorityConfig = LEAD_PRIORITY_CONFIG[lead.priority];

  // Get initials for avatar fallback
  const initials = lead.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="bg-card border rounded-lg p-6">
      <div className="flex items-start justify-between gap-6">
        {/* Left: Photo + Info */}
        <div className="flex items-start gap-4">
          <Avatar className="h-20 w-20">
            <AvatarImage src={lead.photoUrl} alt={lead.name} />
            <AvatarFallback className="text-xl font-semibold bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="space-y-2">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{lead.name}</h1>
              {(lead.title || lead.company) && (
                <p className="text-muted-foreground">
                  {lead.title && lead.company
                    ? `${lead.title} @ ${lead.company}`
                    : lead.title || lead.company}
                </p>
              )}
              {lead.location && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <MapPin className="h-3 w-3" />
                  {lead.location}
                </p>
              )}
            </div>

            {/* Status chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={lead.status}
                onValueChange={(value) => onStatusChange(value as LeadStatus)}
                disabled={updatingStatus}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAD_STATUS_CONFIG).map(([status, config]) => (
                    <SelectItem key={status} value={status} className="text-xs">
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Badge variant={priorityConfig.variant} className="text-xs">
                {priorityConfig.label}
              </Badge>

              {/* Placeholder for persona match - will be added with qualification feature */}
              {/* <Badge variant="outline" className="text-xs">
                AI-Curious CTO (85)
              </Badge> */}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Primary Actions */}
          {researchButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{researchButton}</span>
              </TooltipTrigger>
              <TooltipContent>Research this person</TooltipContent>
            </Tooltip>
          )}

          {nurtureAction}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    disabled={isGeneratingOutreach}
                  >
                    {isGeneratingOutreach ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Linkedin className="h-4 w-4" />
                    )}
                    <span className="ml-1.5 hidden sm:inline">Draft outreach</span>
                    <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Draft LinkedIn outreach</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onGenerateOutreach("inmail")}>
                <Sparkles className="h-4 w-4 mr-2" />
                <div>
                  <div className="font-medium">Personalized</div>
                  <div className="text-xs text-muted-foreground">Custom report + deep research</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onGenerateOutreach("inmail_traditional")}>
                <FileText className="h-4 w-4 mr-2" />
                <div>
                  <div className="font-medium">Traditional</div>
                  <div className="text-xs text-muted-foreground">Link existing content or generic report</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Secondary Actions Dropdown or buttons */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Draft email"
                  size="sm"
                  variant="outline"
                  onClick={() => onGenerateOutreach("email")}
                  disabled={isGeneratingOutreach}
                >
                  <Mail className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Draft email</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Draft content comment"
                  size="sm"
                  variant="outline"
                  onClick={onOpenCommentDialog}
                  disabled={isGeneratingOutreach}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Draft content comment</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" asChild>
                  <Link aria-label="Manage person in People" href="/contacts">
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage person in People</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Remove from Outreach"
                  size="sm"
                  variant="outline"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from Outreach</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
