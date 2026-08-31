"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MediaKind, VisualBrief, VisualType } from "./media-types";

const visualTypes: Record<MediaKind, Array<{ key: VisualType; label: string }>> = {
  image: [
    { key: "editorial-scene", label: "Editorial scene" }, { key: "illustration", label: "Illustration" },
    { key: "infographic", label: "Infographic" }, { key: "diagram", label: "Diagram" },
    { key: "data-chart", label: "Data chart" }, { key: "quote-card", label: "Quote or stat card" },
    { key: "meme", label: "Meme" }, { key: "product-showcase", label: "Product showcase" },
  ],
  video: [{ key: "cinematic-clip", label: "Cinematic clip" }],
};

export function VisualBriefDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: MediaKind;
  submitting?: boolean;
  title?: string;
  submitLabel?: string;
  onSubmit: (brief: VisualBrief) => void | Promise<void>;
}) {
  const [kind, setKind] = React.useState<MediaKind>(props.initialKind ?? "image");
  const [visualType, setVisualType] = React.useState<VisualType>(kind === "image" ? "editorial-scene" : "cinematic-clip");
  const [exactOnMediaText, setExactOnMediaText] = React.useState("");
  const [creativeDirection, setCreativeDirection] = React.useState("");

  React.useEffect(() => {
    if (!props.open) return;
    const nextKind = props.initialKind ?? "image";
    setKind(nextKind);
    setVisualType(nextKind === "image" ? "editorial-scene" : "cinematic-clip");
    setExactOnMediaText("");
    setCreativeDirection("");
  }, [props.initialKind, props.open]);

  const changeKind = (next: MediaKind) => {
    setKind(next);
    setVisualType(next === "image" ? "editorial-scene" : "cinematic-clip");
  };

  const submit = () => {
    const brief: VisualBrief = {
      kind,
      visualType,
      ...(kind === "image" && exactOnMediaText.trim() ? { exactOnMediaText: exactOnMediaText.trim() } : {}),
      ...(creativeDirection.trim() ? { creativeDirection: creativeDirection.trim() } : {}),
    };
    props.onOpenChange(false);
    void props.onSubmit(brief);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.title ?? "Visual Brief"}</DialogTitle>
          <DialogDescription>Choose the visual form and add only the direction that matters to you.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="visual-brief-kind">Media kind</Label>
            <Select value={kind} onValueChange={(value) => changeKind(value as MediaKind)}>
              <SelectTrigger id="visual-brief-kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="image">Image</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="visual-brief-type">Visual type</Label>
            <Select value={visualType} onValueChange={(value) => setVisualType(value as VisualType)}>
              <SelectTrigger id="visual-brief-type"><SelectValue /></SelectTrigger>
              <SelectContent>{visualTypes[kind].map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {kind === "image" ? (
            <div className="grid gap-2">
              <Label htmlFor="visual-brief-text">Exact on-media text <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="visual-brief-text" maxLength={280} onChange={(event) => setExactOnMediaText(event.target.value)} placeholder="Text that must appear inside the visual" value={exactOnMediaText} />
              <p className="text-xs text-muted-foreground">This is separate from the Post caption and alt text.</p>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="visual-brief-direction">Creative direction <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="visual-brief-direction" maxLength={2000} onChange={(event) => setCreativeDirection(event.target.value)} placeholder="Mood, composition, audience, colors, or constraints" value={creativeDirection} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={props.submitting} onClick={() => props.onOpenChange(false)} variant="outline">Cancel</Button>
          <Button disabled={props.submitting} onClick={submit}>
            {props.submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {props.submitLabel ?? "Generate media"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
