import { notFound, permanentRedirect } from "next/navigation";

import { getContentDraftById } from "@/products/content-generator/data/content-repository";

export default async function LegacyDraftRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getContentDraftById(id);

  if (!post) notFound();
  permanentRedirect(`/content/${post.ideaId}/posts/${post.id}`);
}
