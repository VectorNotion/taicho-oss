"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle, Circle, Loader, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ContextLevel = "short" | "medium" | "long";

interface ContextItem {
  id: string;
  title: string;
  status: "planned" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
  createdAt?: string;
}

interface ContextViewProps {
  level: ContextLevel;
  items: ContextItem[];
}

const levelConfig = {
  short: {
    title: "Short-Term Context",
    description: "Current week goals and content",
  },
  medium: {
    title: "Medium-Term Context",
    description: "Current month objectives",
  },
  long: {
    title: "Long-Term Context",
    description: "Vision and long-term goals",
  },
};

const statusConfig = {
  planned: {
    border: "",
    icon: Circle,
    label: "planned",
  },
  in_progress: {
    border: "border-l-4 border-l-blue-500",
    icon: Loader,
    label: "in progress",
  },
  completed: {
    border: "",
    icon: CheckCircle,
    label: "completed",
  },
};

export function ContextView({ level, items }: ContextViewProps) {
  const config = levelConfig[level];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{config.title}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet</p>
            ) : (
              items.map((item) => {
                const statusStyle = statusConfig[item.status];
                const StatusIcon = statusStyle.icon;

                return (
                  <div
                    key={item.id}
                    className={`p-4 border rounded-lg space-y-2 bg-card hover:bg-muted/50 transition-colors ${statusStyle.border}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-base font-medium flex-1 leading-snug">{item.title}</h4>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 -mt-1 -mr-1 hover:bg-transparent"
                        onClick={() => {
                          // TODO: Implement delete functionality
                          console.log("Delete item:", item.id);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <StatusIcon className="w-3.5 h-3.5" />
                        <span>{statusStyle.label}</span>
                      </div>
                      {item.createdAt && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
