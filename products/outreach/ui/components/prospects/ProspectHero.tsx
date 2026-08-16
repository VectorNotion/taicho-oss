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
  Loader2,
  Mic,
} from "lucide-react";
import Link from "next/link";
import type { Prospect, ProspectStatus } from "@/products/outreach/domain/types";
import { PROSPECT_STATUS_CONFIG, PROSPECT_PRIORITY_CONFIG } from "@/products/outreach/domain/types";

interface ProspectHeroProps {
  prospect: Prospect;
  isDeleting: boolean;
  updatingStatus: boolean;
  onStatusChange: (status: ProspectStatus) => void;
  onDelete: () => void;
  /** Optional cross-product action, present when Nurture is available. */
  nurtureAction?: React.ReactNode;
  /** Optional contextual assistant action, present in the unified shell. */
  assistantAction?: React.ReactNode;
  /** Opens the standalone Call Recording app with this prospect selected. */
  callRecordingUrl?: string;
}

export function ProspectHero({
  prospect,
  isDeleting,
  updatingStatus,
  onStatusChange,
  onDelete,
  nurtureAction,
  assistantAction,
  callRecordingUrl,
}: ProspectHeroProps) {
  const priorityConfig = PROSPECT_PRIORITY_CONFIG[prospect.priority];

  // Get initials for avatar fallback
  const initials = prospect.name
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
            <AvatarImage src={prospect.photoUrl} alt={prospect.name} />
            <AvatarFallback className="text-xl font-semibold bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="space-y-2">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{prospect.name}</h1>
              {(prospect.title || prospect.company) && (
                <p className="text-muted-foreground">
                  {prospect.title && prospect.company
                    ? `${prospect.title} @ ${prospect.company}`
                    : prospect.title || prospect.company}
                </p>
              )}
              {prospect.location && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <MapPin className="h-3 w-3" />
                  {prospect.location}
                </p>
              )}
            </div>

            {/* Status chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={prospect.status}
                onValueChange={(value) => onStatusChange(value as ProspectStatus)}
                disabled={updatingStatus}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROSPECT_STATUS_CONFIG).map(([status, config]) => (
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
          {assistantAction}
          {nurtureAction}

          {callRecordingUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" asChild>
                  <a aria-label={`Record call with ${prospect.name}`} href={callRecordingUrl}>
                    <Mic className="h-4 w-4" />
                    <span className="hidden sm:inline">Record call</span>
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open Call Recording with this prospect selected</TooltipContent>
            </Tooltip>
          )}

          <div className="flex items-center gap-1">
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
