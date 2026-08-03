import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContentPreviewGallery } from '../../components/ContentPreviewGallery';

export const metadata: Metadata = {
  title: 'Content previews · Taicho',
  description: 'Platform-native content preview surfaces for drafts the chatbot produces',
};

export default function ContentPreviewPage() {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-10">
      <div className="w-full min-w-0 space-y-6 pb-24">
        <Link className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground" href="/">
          <ArrowLeft className="size-4" /> Chatbot specification
        </Link>
        <ContentPreviewGallery />
      </div>
    </main>
  );
}
