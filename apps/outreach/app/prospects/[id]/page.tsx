import { redirect } from 'next/navigation';

export default async function LegacyProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/outreach/prospects/${id}`);
}
