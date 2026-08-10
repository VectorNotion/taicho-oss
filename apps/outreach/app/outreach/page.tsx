import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  FileText,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { PageHeader } from "@/components/PageHeader";
import { StatRow } from "@/components/StatRow";
import {
  getProspectCounts,
  getProspectsPage,
  getOutreachMessageCounts,
  getOutreachMessages,
} from "@/products/outreach/data/prospect-repository";
import {
  PROSPECT_STATUS_CONFIG,
  OUTREACH_MEDIUM_CONFIG,
} from "@/products/outreach/domain/types";

export const dynamic = "force-dynamic";

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export default async function OutreachOverviewPage() {
  const [counts, recent, messageCounts, drafts] = await Promise.all([
    getProspectCounts(),
    getProspectsPage(undefined, { page: 1, pageSize: 6 }),
    getOutreachMessageCounts(),
    getOutreachMessages({ status: "draft", limit: 5 }),
  ]);

  const draftCount = messageCounts.byStatus.draft ?? 0;
  const activeConversations =
    (counts.byStatus.contacted ?? 0) + (counts.byStatus.replied ?? 0);
  const readyForNextStep =
    (counts.byStatus.researched ?? 0) + (counts.byStatus.qualified ?? 0);
  const converted = counts.byStatus.converted ?? 0;

  const metrics = [
    {
      label: "Prospects",
      value: counts.total.toLocaleString(),
      description: "People with an Outreach role",
      featured: true,
    },
    {
      label: "Ready for a next step",
      value: readyForNextStep.toLocaleString(),
      description: "Researched or qualified",
    },
    {
      label: "Drafts to review",
      value: draftCount.toLocaleString(),
      description: "Prepared, not delivered",
    },
    {
      label: "Active conversations",
      value: activeConversations.toLocaleString(),
      description: `${converted.toLocaleString()} converted`,
    },
  ];

  const queue = [
    {
      count: counts.byStatus.new ?? 0,
      description: "Gather context before deciding how to approach them.",
      href: "/outreach/prospects",
      icon: Search,
      label: "Research new people",
    },
    {
      count: readyForNextStep,
      description: "Review fit and prepare the right outreach angle.",
      href: "/outreach/prospects",
      icon: Sparkles,
      label: "Act on researched people",
    },
    {
      count: draftCount,
      description: "Review copy, send it externally, then record the outcome.",
      href: "/outreach/drafts",
      icon: FileText,
      label: "Review prepared drafts",
    },
    {
      count: counts.byStatus.contacted ?? 0,
      description: "Keep the conversation moving while the context is fresh.",
      href: "/outreach/prospects",
      icon: CircleDot,
      label: "Follow up with contacted people",
    },
  ];

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/contacts">Find people</Link>
            </Button>
            <Button asChild>
              <Link href="/outreach/prospects">
                Open prospects
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        }
        description="Decide who to approach, prepare informed outreach, and keep every conversation moving."
        title="Outreach"
      />

      <StatRow stats={metrics} />

      <ListCard
        description="The next useful actions across your current prospects."
        title="Your outreach queue"
      >
        <ListRows>
          {queue.map((item) => (
            <ListRow
              actions={[{
                href: item.href,
                iconName: "arrow-right",
                label: `Open ${item.label}`,
              }]}
              badge={
                <Badge variant={item.count ? "secondary" : "outline"}>
                  {item.count.toLocaleString()}
                </Badge>
              }
              href={item.href}
              key={item.label}
              leading={
                <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="size-4" />
                </span>
              }
              meta={[item.description]}
              title={item.label}
            />
          ))}
        </ListRows>
      </ListCard>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ListCard
          description="The latest people added to Outreach."
          title="Recently added"
        >
          {recent.prospects.length === 0 ? (
            <div className="grid min-h-56 place-items-center px-6 text-center">
              <div className="max-w-sm">
                <Users className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No prospects yet</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Add people to the shared directory, then start Outreach for
                  the people you want to research and contact.
                </p>
                <Button asChild className="mt-4" size="sm">
                  <Link href="/contacts">Open People</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ListRows>
              {recent.prospects.map((prospect) => (
                <ListRow
                  actions={[{
                    href: `/outreach/prospects/${prospect.id}`,
                    iconName: "arrow-right",
                    label: `Open ${prospect.name}`,
                  }]}
                  badge={
                    <Badge variant={PROSPECT_STATUS_CONFIG[prospect.status].variant}>
                      {PROSPECT_STATUS_CONFIG[prospect.status].label}
                    </Badge>
                  }
                  href={`/outreach/prospects/${prospect.id}`}
                  key={prospect.id}
                  leading={
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {prospect.name.slice(0, 1).toUpperCase()}
                    </span>
                  }
                  meta={[
                    [prospect.title, prospect.company].filter(Boolean).join(" · ")
                      || prospect.email
                      || "Outreach target",
                  ]}
                  title={prospect.name}
                />
              ))}
            </ListRows>
          )}
        </ListCard>

        <ListCard
          description="Prepared messages that still need review."
          title="Latest drafts"
        >
          {drafts.length === 0 ? (
            <div className="grid min-h-56 place-items-center px-6 text-center">
              <div className="max-w-sm">
                <CheckCircle2 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">The review queue is clear</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  New messages appear here after you prepare outreach from a
                  person&apos;s prospect record.
                </p>
              </div>
            </div>
          ) : (
            <>
              <ListRows>
                {drafts.slice(0, 5).map(({ prospect, message }) => (
                  <ListRow
                    actions={[{
                      href: `/outreach/prospects/${prospect.id}`,
                      iconName: "arrow-right",
                      label: `Review draft for ${prospect.name}`,
                    }]}
                    href={`/outreach/prospects/${prospect.id}`}
                    key={message.id}
                    leading={
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <FileText className="size-4" />
                      </span>
                    }
                    meta={[
                      message.subject || OUTREACH_MEDIUM_CONFIG[message.medium].label,
                      <time dateTime={message.updatedAt} key="updated">
                        {formatMoment(message.updatedAt)}
                      </time>,
                    ]}
                    title={prospect.name}
                  />
                ))}
              </ListRows>
              <div className="px-5 py-3">
                <Button asChild className="w-full" size="sm" variant="ghost">
                  <Link href="/outreach/drafts">
                    Review all drafts
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </ListCard>
      </div>
    </div>
  );
}
