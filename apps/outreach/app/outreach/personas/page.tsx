import { getPersonas } from "@/products/outreach/data/persona-repository";
import { PersonasPageClient } from "@/products/outreach/ui/components/personas/PersonasPageClient";

export const dynamic = "force-dynamic";

export default async function PersonasPage() {
  return <PersonasPageClient initialPersonas={await getPersonas()} />;
}
