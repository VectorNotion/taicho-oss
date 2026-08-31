import { z } from "zod";

export const CALENDAR_ENTRY_CHANGED_EVENT = "calendar.entry.changed";
export const CALENDAR_READ_CAPABILITY_ID = "calendar.events.list";

export const calendarEntryStateSchema = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
]);

export type CalendarEntryState = z.infer<typeof calendarEntryStateSchema>;

const namespacedKey = z.string().trim().regex(
  /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/,
  "Use a namespaced key such as outreach.follow_up.",
);

const moduleKey = z.string().trim().regex(/^[a-z][a-z0-9_-]*$/);
const capabilityId = z.string().trim().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);

export const calendarActionTemplateSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(100),
  capabilityId,
  method: z.enum(["POST", "PATCH", "DELETE"]),
  pathTemplate: z.string().trim().startsWith("/").max(500),
  body: z.record(z.string(), z.unknown()).optional(),
  states: z.array(calendarEntryStateSchema).min(1),
  destructive: z.boolean().default(false),
});

export const calendarEventKindSchema = z.object({
  key: namespacedKey,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  authorization: z.object({
    product: z.enum(["content", "outreach", "cascade"]),
    action: z.literal("read"),
  }),
  actions: z.array(calendarActionTemplateSchema).default([]),
});

export const calendarModuleManifestSchema = z.object({
  moduleKey,
  name: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  readCapabilityId: z.literal(CALENDAR_READ_CAPABILITY_ID),
  scheduling: z.discriminatedUnion("ownsEvents", [
    z.object({ ownsEvents: z.literal(true) }),
    z.object({
      ownsEvents: z.literal(false),
      reason: z.string().trim().min(1).max(500),
    }),
  ]),
  eventKinds: z.array(calendarEventKindSchema),
}).superRefine((manifest, context) => {
  if (manifest.scheduling.ownsEvents && manifest.eventKinds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["eventKinds"],
      message: `${manifest.moduleKey} owns scheduled work and must declare at least one event kind.`,
    });
  }
  if (!manifest.scheduling.ownsEvents && manifest.eventKinds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["eventKinds"],
      message: `${manifest.moduleKey} cannot declare event kinds while scheduling ownership is disabled.`,
    });
  }
  const seen = new Set<string>();
  for (const kind of manifest.eventKinds) {
    if (!kind.key.startsWith(`${manifest.moduleKey}.`)) {
      context.addIssue({
        code: "custom",
        path: ["eventKinds"],
        message: `${kind.key} must use the ${manifest.moduleKey} namespace.`,
      });
    }
    if (seen.has(kind.key)) {
      context.addIssue({ code: "custom", path: ["eventKinds"], message: `Duplicate event kind ${kind.key}.` });
    }
    seen.add(kind.key);
  }
});

export type CalendarActionTemplate = z.infer<typeof calendarActionTemplateSchema>;
export type CalendarEventKind = z.infer<typeof calendarEventKindSchema>;
export type CalendarModuleManifest = z.infer<typeof calendarModuleManifestSchema>;

export const calendarEntryInputSchema = z.object({
  state: calendarEntryStateSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2_000).nullable().default(null),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  allDay: z.boolean().default(false),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  href: z.string().trim().startsWith("/").max(2_000),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((entry, context) => {
  if (entry.endsAt && new Date(entry.endsAt).getTime() < new Date(entry.startsAt).getTime()) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must not precede startsAt." });
  }
});

const calendarChangeBase = z.object({
  moduleKey,
  kindKey: namespacedKey,
  sourceId: z.string().trim().min(1).max(500),
  revision: z.string().trim().min(1).max(500),
  changedAt: z.string().datetime({ offset: true }),
});

export const calendarEntryChangeSchema = z.discriminatedUnion("operation", [
  calendarChangeBase.extend({
    operation: z.literal("upsert"),
    entry: calendarEntryInputSchema,
  }),
  calendarChangeBase.extend({
    operation: z.literal("remove"),
  }),
]);

export type CalendarEntryInput = z.infer<typeof calendarEntryInputSchema>;
export type CalendarEntryChange = z.infer<typeof calendarEntryChangeSchema>;

export interface CalendarEntry extends CalendarEntryInput {
  id: string;
  organizationId: string;
  moduleKey: string;
  moduleName: string;
  kindKey: string;
  kindName: string;
  sourceId: string;
  revision: string;
  changedAt: string;
  createdAt: string;
  updatedAt: string;
  actions: CalendarEntryAction[];
}

export interface CalendarEntryAction {
  key: string;
  label: string;
  capabilityId: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  destructive: boolean;
}

export function defineCalendarManifest(input: CalendarModuleManifest): CalendarModuleManifest {
  return calendarModuleManifestSchema.parse(input) as CalendarModuleManifest;
}

/**
 * Explicit contribution for a module that reads the shared calendar but does
 * not currently own user-visible scheduled work. This is participation, not
 * a placeholder: adding a scheduler requires changing the ownership contract
 * and declaring its namespaced event kinds in the same module.
 */
export function defineCalendarAwareManifest(input: {
  moduleKey: string;
  name: string;
  version?: number;
  reason: string;
}): CalendarModuleManifest {
  return defineCalendarManifest({
    moduleKey: input.moduleKey,
    name: input.name,
    version: input.version ?? 1,
    readCapabilityId: CALENDAR_READ_CAPABILITY_ID,
    scheduling: { ownsEvents: false, reason: input.reason },
    eventKinds: [],
  });
}
