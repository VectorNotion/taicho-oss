"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Linkedin, Copy, Check, MessageSquare, User, Building } from "lucide-react";
import { useState } from "react";
import { parseToolResult, OutreachResult } from "./types";

interface OutreachArgs {
  lead_name: string;
  company: string;
  context?: string;
}

const mediumIcons: Record<string, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
  inmail: <MessageSquare className="h-4 w-4" />,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  inmail: "InMail",
};

interface OutreachRendererProps {
  args: OutreachArgs;
  result?: string;
  status: { type: string };
}

function OutreachRenderer({ args, result, status }: OutreachRendererProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (status.type === "running") {
    return (
        <Card className="my-4 border-green-200 dark:border-green-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 animate-pulse" />
              Drafting outreach for {args.lead_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
    );
  }

  const parsed = parseToolResult(result);
  if (!parsed || parsed.type !== "outreach_draft") {
    return (
        <Card className="my-4 border-muted">
          <CardContent className="py-4 text-sm text-muted-foreground">
            {typeof result === "string" ? result : "Outreach drafted"}
          </CardContent>
        </Card>
    );
  }

  const data = parsed as OutreachResult;

  return (
      <Card className="my-4 border-green-200 dark:border-green-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-green-600" />
            Outreach Drafts
          </CardTitle>
          <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {data.lead.name}
            </span>
            <span className="flex items-center gap-1">
              <Building className="h-3 w-3" />
              {data.lead.company}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={data.drafts[0]?.medium} className="w-full">
            <TabsList className="mb-4">
              {data.drafts.map((draft) => (
                <TabsTrigger
                  key={draft.medium}
                  value={draft.medium}
                  className="flex items-center gap-2"
                >
                  {mediumIcons[draft.medium]}
                  {mediumLabels[draft.medium] || draft.medium}
                </TabsTrigger>
              ))}
            </TabsList>
            {data.drafts.map((draft, index) => (
              <TabsContent key={draft.medium} value={draft.medium}>
                <div className="rounded-lg border bg-muted/50 p-4">
                  {draft.subject && (
                    <div className="mb-3 border-b pb-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        Subject:
                      </span>
                      <p className="mt-1 font-medium text-sm">{draft.subject}</p>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap font-mono text-sm">
                    {draft.message}
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {draft.tone}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {draft.word_count} words
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => handleCopy(draft.message, index)}
                    >
                      {copiedIndex === index ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 h-3 w-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
  );
}

export const OutreachToolUI = makeAssistantToolUI<OutreachArgs, string>({
  toolName: "draft_outreach",
  render: (props) => <OutreachRenderer {...props} />,
});
