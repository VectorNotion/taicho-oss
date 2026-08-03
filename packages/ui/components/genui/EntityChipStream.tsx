'use client';
const TYPE_ORDER = ['BusinessValue', 'Feature', 'AIComponent', 'Integration', 'Database', 'Framework', 'Language', 'Cloud'];
export function EntityChipStream({ entities }: { entities: Array<{ name: string; type: string }> }) {
  const groups = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (!entity?.name || !entity?.type) continue;
    const names = groups.get(entity.type) ?? new Set<string>();
    names.add(entity.name);
    groups.set(entity.type, names);
  }
  const ordered = [...groups.entries()]
    .map(([type, names]) => [type, [...names]] as const)
    .sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a[0]);
      const bi = TYPE_ORDER.indexOf(b[0]);
      return (ai === -1 ? TYPE_ORDER.length : ai) - (bi === -1 ? TYPE_ORDER.length : bi);
    });
  return <div className="space-y-4">{ordered.map(([type, names]) => <div key={type}><div className="mb-1.5 text-xs font-medium text-muted-foreground">{type}s</div><div className="flex flex-wrap gap-1.5">{names.map((name) => <span key={name} className="animate-in fade-in zoom-in-95 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs duration-300">{name}</span>)}</div></div>)}</div>;
}
