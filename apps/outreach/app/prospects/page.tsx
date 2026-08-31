import { redirect } from 'next/navigation';

export default async function LegacyProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) output.append(key, item);
    }
  }
  const query = output.toString();
  redirect(`/outreach/prospects${query ? `?${query}` : ''}`);
}
