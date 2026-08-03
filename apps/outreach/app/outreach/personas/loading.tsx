import { PageHeader } from "@/components/PageHeader";
import { ListSurface } from "@/components/ListSurface";

export default function PersonasLoading() {
  return <div className="w-full min-w-0 space-y-8">
    <PageHeader title="Personas" description="Define reusable audience profiles for qualification and audience-aware work across the platform." />
    <ListSurface
      description="Personas available to audience-aware services."
      isLoading
      title="Workspace personas"
    />
  </div>;
}
