let tableReady: Promise<void> | null = null;

/** Product-event schema is provisioned by the root Drizzle migrations. */
export function ensureProductEventsTable(): Promise<void> {
  return (tableReady ??= Promise.resolve());
}
