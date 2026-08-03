import type { MetadataRoute } from "next";
import { getAllDocumentation } from "@/lib/docs";

export default function sitemap(): MetadataRoute.Sitemap {
  return getAllDocumentation().map((document) => ({
    changeFrequency: "weekly",
    priority: document.href === "/" ? 1 : 0.8,
    url: new URL(document.href, "https://docs.taicho.ai").toString(),
  }));
}
