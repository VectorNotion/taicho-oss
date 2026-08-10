"use client";

import { Badge } from "@/components/ui/badge";
import { dueLabel, dueTone } from "@/products/outreach/domain/action-item-view";

/** The one due-date chip: overdue = destructive, today = default, else secondary. */
export function DueBadge({ dueAt }: { dueAt: string }) {
  const tone = dueTone(dueAt, new Date());
  const variant =
    tone === "overdue" ? "destructive" : tone === "today" ? "default" : "secondary";
  return <Badge variant={variant}>{dueLabel(dueAt, new Date())}</Badge>;
}
