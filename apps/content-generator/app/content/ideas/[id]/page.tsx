import { permanentRedirect } from "next/navigation";

export default async function LegacyIdeaRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/content/${id}`);
}
