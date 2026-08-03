import { redirect } from 'next/navigation';

export default async function LegacyLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/outreach/pipeline/${id}`);
}
