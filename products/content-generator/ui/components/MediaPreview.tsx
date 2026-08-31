"use client";

import { Film } from "lucide-react";
import type { CreativeAssetView } from "./media-types";

export function MediaPreview({ asset, className = "h-full w-full object-cover" }: { asset: CreativeAssetView; className?: string }) {
  if (asset.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={asset.altText} className={className} loading="lazy" src={asset.url} />;
  }
  if (asset.mimeType.startsWith("video/")) {
    return <video aria-label={asset.altText} className={className} controls preload="metadata" src={asset.url} />;
  }
  return <div className="grid h-full w-full place-items-center bg-muted text-muted-foreground"><Film className="size-8" /><span className="sr-only">{asset.description}</span></div>;
}
