export function migrationArgs(argv = process.argv.slice(2)) {
  const organizationIndex = argv.indexOf('--organization');
  const organizationId = organizationIndex >= 0 ? argv[organizationIndex + 1]?.trim() : '';
  if (!organizationId) throw new Error('Pass an explicit --organization <id>.');
  return { organizationId, apply: argv.includes('--apply') };
}

export function graphNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === 'function') return (value as { toNumber: () => number }).toNumber();
  return Number(value ?? 0);
}
