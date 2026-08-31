interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  stackActionsUntil?: "sm" | "xl";
}

export function PageHeader({
  title,
  description,
  actions,
  stackActionsUntil = "sm",
}: PageHeaderProps) {
  const headerLayout = stackActionsUntil === "xl"
    ? "xl:flex-row xl:items-center xl:justify-between"
    : "sm:flex-row sm:items-center sm:justify-between";
  const actionsLayout = stackActionsUntil === "xl"
    ? "xl:w-auto xl:shrink-0"
    : "sm:w-auto sm:shrink-0";

  return (
    <div className={`mb-8 flex min-w-0 flex-col items-start gap-4 ${headerLayout}`}>
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-2">{description}</p>
        )}
      </div>
      {actions && (
        <div className={`flex w-full min-w-0 flex-wrap items-center gap-2 [&>div]:flex-wrap ${actionsLayout}`}>
          {actions}
        </div>
      )}
    </div>
  );
}
