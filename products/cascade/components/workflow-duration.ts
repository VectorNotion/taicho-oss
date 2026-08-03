export type WorkflowDurationUnit =
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month';

export const WORKFLOW_DURATION_UNITS: Array<{
  value: WorkflowDurationUnit;
  label: string;
  seconds: number;
}> = [
  { value: 'minute', label: 'Minutes', seconds: 60 },
  { value: 'hour', label: 'Hours', seconds: 60 * 60 },
  { value: 'day', label: 'Days', seconds: 60 * 60 * 24 },
  { value: 'week', label: 'Weeks', seconds: 60 * 60 * 24 * 7 },
  { value: 'month', label: 'Months', seconds: 60 * 60 * 24 * 30 },
];

const unitsLargestFirst = [...WORKFLOW_DURATION_UNITS].reverse();

export function durationUnitSeconds(unit: WorkflowDurationUnit): number {
  return WORKFLOW_DURATION_UNITS.find((candidate) => candidate.value === unit)
    ?.seconds ?? 60;
}
export function durationFromSeconds(value: unknown): {
  amount: number;
  unit: WorkflowDurationUnit;
} {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { amount: 0, unit: 'minute' };
  }
  const unit = unitsLargestFirst.find(
    (candidate) => seconds >= candidate.seconds,
  ) ?? WORKFLOW_DURATION_UNITS[0];
  return {
    amount: Number((seconds / unit.seconds).toFixed(4)),
    unit: unit.value,
  };
}

export function formatWorkflowDuration(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 'Set wait time';
  if (seconds <= 0) return 'No wait';
  const { amount, unit } = durationFromSeconds(seconds);
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}
