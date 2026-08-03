export type RuntimeBadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export function runtimeStatusVariant(status: string): RuntimeBadgeVariant {
  if (['succeeded', 'published', 'active', 'approved'].includes(status)) return 'default';
  if (['failed', 'timed_out', 'rejected'].includes(status)) return 'destructive';
  if (['queued', 'running', 'waiting', 'needs_approval', 'draft', 'cancelled'].includes(status)) return 'secondary';
  return 'outline';
}
export function runtimeStatusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function runtimeTypeLabel(value: string): string {
  const words = value
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
