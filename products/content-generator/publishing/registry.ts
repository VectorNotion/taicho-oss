import type { DestinationAdapter } from "./types";

const adapters = new Map<string, DestinationAdapter>();

export function registerAdapter(adapter: DestinationAdapter): void {
  adapters.set(adapter.destination, adapter);
}

export function getAdapter(destination: string): DestinationAdapter {
  const adapter = adapters.get(destination);
  if (!adapter) throw new Error(`No adapter registered for destination '${destination}'`);
  return adapter;
}

export function listDestinations(): DestinationAdapter[] {
  return [...adapters.values()];
}

export function hasAdapter(destination: string): boolean {
  return adapters.has(destination);
}
