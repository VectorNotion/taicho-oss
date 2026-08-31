import { defineCalendarAwareManifest } from '@content-automation/platform/calendar/contracts';

export const agentsCalendarManifest = defineCalendarAwareManifest({
  moduleKey: 'agents',
  name: 'Agents',
  reason: 'Agents configure external runtimes and credentials; they do not own user-visible scheduled work.',
});
