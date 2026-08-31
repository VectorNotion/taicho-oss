import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));

vi.mock('@content-automation/platform/network/api-client', () => ({ apiGet, apiMutate }));

import {
  useDurableOperation,
  type DurableOperation,
  type DurableOperationStatus,
} from '../hooks/use-durable-operation';

function operation(
  status: DurableOperationStatus,
  overrides: Partial<DurableOperation> = {},
): DurableOperation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    action: 'research_prospect',
    entityId: 'prospect-1',
    status,
    progress: status === 'succeeded' ? 100 : 35,
    attempt: 1,
    maxAttempts: 3,
    result: null,
    error: null,
    estimatedCredits: 80,
    createdAt: '2026-08-27T00:00:00.000Z',
    startedAt: '2026-08-27T00:00:01.000Z',
    completedAt: null,
    updatedAt: '2026-08-27T00:00:02.000Z',
    ...overrides,
  };
}

function useResearchOperation() {
  return useDurableOperation<Record<string, unknown>, { dimensions: Array<{ dimensionKey: string }> }>({
    action: 'research_prospect',
    entityId: 'prospect-1',
    startApi: '/outreach/operations/prospect-research',
    body: { prospectId: 'prospect-1' },
    pollIntervalMs: 10,
  });
}

describe('useDurableOperation', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiMutate.mockReset();
  });

  it('reconnects to the same processing operation and preserves its dimension snapshot through completion', async () => {
    const progressSnapshot = { dimensions: [{ dimensionKey: 'authority' }] };
    const processing = operation('processing', { result: { progressSnapshot } });
    const succeeded = operation('succeeded', {
      progress: 100,
      result: { personaScore: 82 },
      completedAt: '2026-08-27T00:00:03.000Z',
    });
    let finishPoll: ((value: { operation: DurableOperation }) => void) | undefined;
    apiGet.mockImplementation(async (path: string) => (
      path === '/operations'
        ? { operations: [processing] }
        : await new Promise<{ operation: DurableOperation }>((resolve) => { finishPoll = resolve; })
    ));

    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(result.current.operation?.id).toBe(processing.id));
    expect(result.current.isRunning).toBe(true);
    expect(result.current.progressSnapshot).toEqual(progressSnapshot);

    await waitFor(() => expect(finishPoll).toBeTypeOf('function'));
    await act(async () => { finishPoll?.({ operation: succeeded }); });
    await waitFor(() => expect(result.current.isComplete).toBe(true));
    expect(result.current.final).toEqual({ personaScore: 82 });
    expect(result.current.progressSnapshot).toEqual(progressSnapshot);
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it('restores the latest succeeded receipt after reload without replaying it', async () => {
    const succeeded = operation('succeeded', {
      progress: 100,
      result: { status: 'success' },
      completedAt: '2026-08-27T00:00:03.000Z',
    });
    apiGet.mockResolvedValue({ operations: [succeeded] });

    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(result.current.operation?.id).toBe(succeeded.id));

    expect(result.current.isComplete).toBe(true);
    expect(result.current.final).toEqual({ status: 'success' });
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it('does not let an older failed run hide the newest successful research', async () => {
    const succeeded = operation('succeeded', {
      id: '22222222-2222-4222-8222-222222222222',
      result: { status: 'success', progressSnapshot: { dimensions: [{ dimensionKey: 'authority' }] } },
      completedAt: '2026-08-27T00:00:05.000Z',
      updatedAt: '2026-08-27T00:00:05.000Z',
    });
    const olderFailure = operation('failed', {
      error: { code: 'OPERATION_FAILED', message: 'Old provider failure.' },
      completedAt: '2026-08-27T00:00:03.000Z',
    });
    apiGet.mockResolvedValue({ operations: [succeeded, olderFailure] });

    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(result.current.operation?.id).toBe(succeeded.id));

    expect(result.current.error).toBeNull();
    expect(result.current.isComplete).toBe(true);
    expect(result.current.progressSnapshot).toEqual({ dimensions: [{ dimensionKey: 'authority' }] });
  });

  it('coalesces duplicate starts and creates only one durable operation', async () => {
    apiGet.mockResolvedValue({ operations: [] });
    const queued = operation('queued', { attempt: 0, progress: 0, startedAt: null });
    apiMutate.mockResolvedValue({ data: { operation: queued } });
    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });

    expect(apiMutate).toHaveBeenCalledTimes(1);
    expect(apiMutate).toHaveBeenCalledWith(
      'POST',
      '/outreach/operations/prospect-research',
      { prospectId: 'prospect-1' },
      { idempotencyKey: expect.any(String) },
    );
    expect(result.current.operation?.id).toBe(queued.id);
  });

  it('can start with the exact interaction payload before React state rerenders', async () => {
    apiGet.mockResolvedValue({ operations: [] });
    const queued = operation('queued', { action: 'generate_outreach', attempt: 0, progress: 0, startedAt: null });
    apiMutate.mockResolvedValue({ data: { operation: queued } });
    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    await act(async () => {
      await result.current.start({ prospectId: 'prospect-1', medium: 'email' });
    });

    expect(apiMutate).toHaveBeenCalledWith(
      'POST',
      '/outreach/operations/prospect-research',
      { prospectId: 'prospect-1', medium: 'email' },
      { idempotencyKey: expect.any(String) },
    );
  });

  it('keeps a failed operation visible and retries that exact operation id', async () => {
    const failed = operation('failed', {
      progress: 52,
      error: { code: 'OPERATION_FAILED', message: 'Provider timed out.' },
      result: { progressSnapshot: { dimensions: [{ dimensionKey: 'authority' }] } },
      completedAt: '2026-08-27T00:00:03.000Z',
    });
    const queued = operation('queued', { attempt: 0, progress: 0, startedAt: null });
    apiGet.mockResolvedValue({ operations: [failed] });
    apiMutate.mockResolvedValue({ data: { operation: queued } });
    const { result } = renderHook(useResearchOperation);
    await waitFor(() => expect(result.current.error).toBe('Provider timed out.'));

    await act(async () => { await result.current.retry(); });

    expect(apiMutate).toHaveBeenCalledWith(
      'POST',
      `/operations/${failed.id}/retry`,
      {},
      { idempotencyKey: expect.any(String) },
    );
    expect(result.current.operation?.status).toBe('queued');
  });
});
