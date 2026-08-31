"use client";

import type { FC } from "react";
import { ArrowUpIcon, Square } from "lucide-react";
import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";

import { ComposerControlDock } from "@/components/chat/control-deck";
import { TooltipIconButton } from "@/components/chat/tooltip-icon-button";
import type {
  ChatContactTarget,
  ChatControlAvailability,
  ChatControls,
} from "@content-automation/platform/intelligence/chat-controls";

export const Composer: FC<{
  autoFocus?: boolean;
  availability: ChatControlAvailability;
  contactTargets?: ChatContactTarget[];
  contactLocked?: boolean;
  controls: ChatControls;
  disabled?: boolean;
  onControlsChange: (controls: ChatControls) => void;
}> = ({
  autoFocus = true,
  availability,
  contactTargets,
  contactLocked = false,
  controls,
  disabled = false,
  onControlsChange,
}) => {
  return (
    <div className="sticky bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-2 overflow-visible bg-gradient-to-t from-background via-background to-transparent pb-3 pt-4 sm:gap-4 sm:pb-4 sm:pt-6 md:pb-6" data-component="CHAT-05 Composer">
      <ThreadScrollToBottom />
      <ComposerPrimitive.Root className="group/input-group relative flex w-full flex-col overflow-visible rounded-2xl border border-primary/25 bg-card shadow-lg shadow-primary/5 transition-[color,box-shadow] outline-none has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/50">
        <ComposerPrimitive.Input
          placeholder="Ask Taicho anything…"
          className="max-h-48 min-h-20 w-full resize-none bg-transparent px-4 py-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:min-h-24"
          rows={3}
          autoFocus={autoFocus}
          aria-label="Message input"
          disabled={disabled}
        />
        <div className="flex items-end gap-2 border-t px-2 py-2">
          <ComposerControlDock
            availability={availability}
            contactTargets={contactTargets}
            contactLocked={contactLocked}
            controls={controls}
            disabled={disabled}
            onControlsChange={onControlsChange}
          />
          <ComposerAction disabled={disabled} />
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowUpIcon className="rotate-180" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ComposerAction: FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  return (
    <div className="relative flex shrink-0 items-center justify-end">
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="size-[34px] rounded-full p-1"
            aria-label="Send message"
            disabled={disabled}
          >
            <ArrowUpIcon className="size-5" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>

      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <TooltipIconButton
            tooltip="Stop generating"
            side="bottom"
            variant="default"
            className="size-[34px] rounded-full border border-muted-foreground/60 hover:bg-primary/75 dark:border-muted-foreground/90"
            aria-label="Stop generating"
            data-component="WORK-06 Stop Control"
          >
            <Square className="size-3.5 fill-white dark:fill-black" />
          </TooltipIconButton>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </div>
  );
};
