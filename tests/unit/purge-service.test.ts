import { afterEach, describe, expect, test, vi } from 'vitest';

import { deletePurgeMessages } from '../../src/services/moderation/purge-service.js';

describe('purge request scheduling', () => {
  afterEach(() => vi.useRealTimers());

  test('bulk deletes recent messages in chunks and avoids individual requests', async () => {
    const remove = vi.fn(async () => undefined);
    const recent = Array.from({ length: 250 }, () => ({ delete: remove }));
    const bulk = vi.fn(async (chunk: typeof recent) => chunk.length);
    expect(await deletePurgeMessages(recent, [], bulk)).toBe(250);
    expect(bulk.mock.calls.map(([chunk]) => chunk.length)).toEqual([100, 100, 50]);
    expect(remove).not.toHaveBeenCalled();
  });

  test('bounds combined old-message and failed-bulk fallback requests to five', async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const remove = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active--;
    });
    const recent = Array.from({ length: 100 }, () => ({ delete: remove }));
    const old = Array.from({ length: 100 }, () => ({ delete: remove }));
    const bulk = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('bulk unavailable'));
    const deleting = deletePurgeMessages(recent, old, bulk);
    await vi.runAllTimersAsync();
    expect(await deleting).toBe(200);
    expect(peak).toBe(5);
    expect(remove).toHaveBeenCalledTimes(200);
  });

  test('counts only successful deletes and continues after individual failures', async () => {
    const missing = { delete: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('deleted')) };
    const existing = { delete: vi.fn(async () => undefined) };
    expect(await deletePurgeMessages([], [missing, existing], async () => 0)).toBe(1);
  });
});
