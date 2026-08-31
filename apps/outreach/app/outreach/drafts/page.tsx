import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { getOutreachMessages } from "@/products/outreach/data/prospect-repository";
import type {
  OutreachMedium,
  OutreachStatus,
} from "@/products/outreach/domain/types";
import { DraftsWorkspace } from "@/products/outreach/ui/components/drafts/DraftsWorkspace";

export const dynamic = "force-dynamic";

const outreachMediums = new Set<OutreachMedium>([
  "inmail",
  "inmail_traditional",
  "email",
  "content_comment",
  "connection_note",
]);

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ medium?: string; q?: string; status?: string }>;
}) {
  const query = await searchParams;
  const messages = await getOutreachMessages({ limit: 500 });
  const status: OutreachStatus | "all" = query.status === "draft" || query.status === "sent"
    ? query.status
    : "all";
  const medium: OutreachMedium | "all" = outreachMediums.has(query.medium as OutreachMedium)
    ? query.medium as OutreachMedium
    : "all";

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={
          <Button asChild variant="outline">
            <Link href="/outreach/prospects">
              Open pipeline
              <ExternalLink className="size-4" />
            </Link>
          </Button>
        }
        description="Review the email, InMail, and content-comment copy prepared for people in your pipeline. Delivery still happens in the external channel."
        title="Drafts"
      />
      <div className="flex items-center gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        <FileText className="size-4 shrink-0 text-primary" />
        This is the shared review queue. Marking a message as sent records the
        external action; it does not deliver the message.
      </div>
      <DraftsWorkspace
        initialFilters={{ medium, search: query.q ?? "", status }}
        initialMessages={messages}
      />
    </div>
  );
}
