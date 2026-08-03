import { redirect } from 'next/navigation';

export default async function LegacyProjectEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/content/projects/${id}/edit`);
}
