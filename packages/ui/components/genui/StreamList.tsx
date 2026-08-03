'use client';
export function StreamList({ items }: { items: string[] }) {
  return <ul className="space-y-2">{items.map((item, index) => <li key={`${index}-${item}`} className="animate-in fade-in slide-in-from-bottom-1 text-sm duration-300"><span className="mr-2 text-muted-foreground">•</span>{item}</li>)}</ul>;
}
