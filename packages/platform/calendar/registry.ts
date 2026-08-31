import {
  calendarModuleManifestSchema,
  type CalendarEntryAction,
  type CalendarEntryState,
  type CalendarEventKind,
  type CalendarModuleManifest,
} from "./contracts";

export interface CompiledCalendarRegistry {
  manifests: readonly CalendarModuleManifest[];
  modules: ReadonlyMap<string, CalendarModuleManifest>;
  eventKinds: ReadonlyMap<string, CalendarEventKind>;
}

export function compileCalendarRegistry(inputs: readonly unknown[]): CompiledCalendarRegistry {
  const manifests = inputs.map((input) => calendarModuleManifestSchema.parse(input) as CalendarModuleManifest);
  const modules = new Map<string, CalendarModuleManifest>();
  const eventKinds = new Map<string, CalendarEventKind>();
  for (const manifest of manifests) {
    if (modules.has(manifest.moduleKey)) throw new Error(`Duplicate calendar module ${manifest.moduleKey}.`);
    modules.set(manifest.moduleKey, manifest);
    for (const kind of manifest.eventKinds) {
      if (eventKinds.has(kind.key)) throw new Error(`Duplicate calendar event kind ${kind.key}.`);
      eventKinds.set(kind.key, kind);
    }
  }
  return { manifests, modules, eventKinds };
}

function resolvedPath(template: string, sourceId: string): string {
  return template.replaceAll("{sourceId}", encodeURIComponent(sourceId));
}

export function calendarActionsFor(
  registry: CompiledCalendarRegistry,
  kindKey: string,
  sourceId: string,
  state: CalendarEntryState,
): CalendarEntryAction[] {
  const kind = registry.eventKinds.get(kindKey);
  if (!kind) return [];
  return kind.actions
    .filter((action) => action.states.includes(state))
    .map((action) => ({
      key: action.key,
      label: action.label,
      capabilityId: action.capabilityId,
      method: action.method,
      path: resolvedPath(action.pathTemplate, sourceId),
      ...(action.body ? { body: action.body } : {}),
      destructive: action.destructive,
    }));
}

class CalendarRegistryHolder {
  #registry: CompiledCalendarRegistry = compileCalendarRegistry([]);

  replace(manifests: readonly unknown[]): CompiledCalendarRegistry {
    this.#registry = compileCalendarRegistry(manifests);
    return this.#registry;
  }

  current(): CompiledCalendarRegistry {
    return this.#registry;
  }
}

export const calendarRegistry = new CalendarRegistryHolder();
