import type { Metadata } from "next";
import { ContentPreviewGallery } from "@/apps/chatbot-spec/components/ContentPreviewGallery";

export const metadata: Metadata = {
  title: "Vector Notion · Content previews",
  description: "Platform-native content preview surfaces — X, LinkedIn, YouTube, and blog drafts as the platforms render them",
};

export default function ContentPreviewsPage() {
  return (
    <div className="w-full min-w-0">
      <ContentPreviewGallery />
    </div>
  );
}
