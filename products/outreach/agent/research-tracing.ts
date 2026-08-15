import { serializeWorkflowContent } from '@content-automation/observability';

export interface DatabaseReadSummary {
  system: 'falkordb';
  groupedOperation: string;
  logicalReads: number;
  recordsLoaded: Record<string, number>;
  totalRecords: number;
  /** Size of the records materialized for this workflow, not network wire bytes. */
  serializedBytes: number;
}

export function summarizeDatabaseRead(
  groupedOperation: string,
  value: unknown,
  logicalReads: number,
  recordsLoaded: Record<string, number>,
): DatabaseReadSummary {
  return {
    system: 'falkordb',
    groupedOperation,
    logicalReads,
    recordsLoaded,
    totalRecords: Object.values(recordsLoaded).reduce((total, count) => total + count, 0),
    serializedBytes: serializeWorkflowContent(value).bytes,
  };
}
