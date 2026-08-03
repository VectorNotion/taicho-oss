export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Annotates a demo with the classes/rule it demonstrates. */
export function Spec({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

/** Dashed frame for demos of page-level constructs (headers, detail tops). */
export function DemoFrame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-6">{children}</div>;
}
