"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyablePrompt(props: { label: string; prompt: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(props.prompt);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("The prompt could not be copied. Select the text and copy it manually.");
    }
  };

  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{props.label}</p>
        <Button
          aria-label={`Copy ${props.label.toLowerCase()}`}
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => void copyPrompt()}
          size="sm"
          type="button"
          variant="ghost"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">{props.prompt}</pre>
    </div>
  );
}
