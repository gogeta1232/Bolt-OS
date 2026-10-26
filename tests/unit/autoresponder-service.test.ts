import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AutoResponderDocument } from '../../src/database/models/features/AutoResponder.js';
import { AutoResponderService } from '../../src/services/features/autoresponder-service.js';

const boundary = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AutoResponderDocument[]>>(),
  create: vi.fn<() => Promise<void>>(),
  findOne: vi.fn<() => Promise<AutoResponderDocument | null>>(),
  update: vi.fn<(...args: unknown[]) => { exec: () => Promise<{ matchedCount: number }> }>(),
  remove: vi.fn<() => Promise<void>>()
}));
vi.mock('../../src/database/models/features/AutoResponder.js', () => ({
  AutoResponderModel: {
    find: () => ({ lean: () => ({ exec: boundary.read }) }),
    create: boundary.create,
    findOne: () => ({ lean: () => ({ exec: boundary.findOne }) }),
    updateOne: boundary.update,
    deleteOne: () => ({ exec: boundary.remove })
  }
}));

const entry: AutoResponderDocument = {
  guildId: 'guild',
  trigger: 'hello',
  response: 'hi',
  caseSensitive: false,
  useEmbed: false,
  createdBy: 'admin',
  createdAt: new Date(0)
};

describe('autoresponder cache under load', () => {
  beforeEach(() => {
    boundary.read.mockReset().mockResolvedValue([entry]);
    boundary.create.mockReset().mockResolvedValue(undefined);
    boundary.findOne.mockReset().mockResolvedValue(entry);
    boundary.update.mockReset().mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });
    boundary.remove.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  test('20 cold requests share one database lookup, then use the cache', async () => {
    const service = new AutoResponderService();
    const results = await Promise.all(Array.from({ length: 20 }, () => service.list('guild')));
    expect(results.every((result) => result[0] === entry)).toBe(true);
    await service.list('guild');
    expect(boundary.read).toHaveBeenCalledTimes(1);
  });

  test('expires results and isolates guilds', async () => {
    vi.useFakeTimers();
    const service = new AutoResponderService();
    await service.list('guild');
    await service.list('other');
    vi.advanceTimersByTime(60_001);
    await service.list('guild');
    expect(boundary.read).toHaveBeenCalledTimes(3);
  });

  test('failed queries can be retried', async () => {
    boundary.read.mockRejectedValueOnce(new Error('offline'));
    const service = new AutoResponderService();
    await expect(service.list('guild')).rejects.toThrow('offline');
    expect(await service.list('guild')).toEqual([entry]);
    expect(boundary.read).toHaveBeenCalledTimes(2);
  });

  test('duplicate adds keep the stored responder and cached response', async () => {
    const service = new AutoResponderService();
    await service.list('guild');
    boundary.create.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));
    await expect(service.add({ ...entry, response: 'replacement' })).resolves.toBe('exists');
    expect(await service.list('guild')).toEqual([entry]);
    expect(boundary.read).toHaveBeenCalledTimes(1);
    expect(boundary.remove).not.toHaveBeenCalled();
  });

  test('successful adds invalidate the cache and report persistence', async () => {
    const service = new AutoResponderService();
    await service.list('guild');
    await expect(service.add(entry)).resolves.toBe('added');
    await service.list('guild');
    expect(boundary.read).toHaveBeenCalledTimes(2);
  });

  test('database failures remain errors without deleting existing responders', async () => {
    const service = new AutoResponderService();
    boundary.create.mockRejectedValueOnce(new Error('offline'));
    await expect(service.add(entry)).rejects.toThrow('offline');
    expect(boundary.remove).not.toHaveBeenCalled();
  });

  test('identical responses need no overwrite, even if optional settings differ', async () => {
    const service = new AutoResponderService();
    expect(await service.prepareOverwrite({ ...entry, useEmbed: true })).toBe('same');
    expect(boundary.update).not.toHaveBeenCalled();
  });

  test('changed responses wait for confirmation and atomically preserve metadata', async () => {
    const service = new AutoResponderService();
    await service.list('guild');
    const pending = await service.prepareOverwrite({ ...entry, response: 'new', useEmbed: true });
    if (typeof pending === 'string') throw new Error('Expected a confirmation');
    expect(boundary.update).not.toHaveBeenCalled();
    expect(await service.resolveOverwrite(pending.token, 'guild', 'other', true)).toBe('stale');
    expect(await service.resolveOverwrite(pending.token, 'other', 'admin', true)).toBe('stale');
    expect(await service.resolveOverwrite(pending.token, 'guild', 'admin', true)).toBe('updated');
    expect(boundary.update).toHaveBeenCalledWith(
      entry,
      {
        $set: { response: 'new', caseSensitive: false, useEmbed: true }
      },
      { runValidators: true }
    );
    await service.list('guild');
    expect(boundary.read).toHaveBeenCalledTimes(2);
    expect(await service.resolveOverwrite(pending.token, 'guild', 'admin', true)).toBe('stale');
    expect(boundary.update).toHaveBeenCalledTimes(1);
    expect(boundary.remove).not.toHaveBeenCalled();
  });

  test.each(['cancel', 'expire', 'changed', 'remove', 'shutdown'] as const)(
    '%s cannot overwrite existing data',
    async (action) => {
      vi.useFakeTimers();
      const service = new AutoResponderService();
      const pending = await service.prepareOverwrite({ ...entry, response: 'new' });
      if (typeof pending === 'string') throw new Error('Expected a confirmation');
      if (action === 'expire') vi.advanceTimersByTime(120_001);
      if (action === 'remove') service.invalidateGuild('guild');
      if (action === 'shutdown') service.shutdown();
      if (action === 'changed') boundary.update.mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });
      expect(await service.resolveOverwrite(pending.token, 'guild', 'admin', action !== 'cancel')).toBe(
        action === 'cancel' ? 'cancelled' : 'stale'
      );
      expect(boundary.update).toHaveBeenCalledTimes(action === 'changed' ? 1 : 0);
    }
  );

  test('removed responders do not get recreated by preparing an overwrite', async () => {
    boundary.findOne.mockResolvedValue(null);
    expect(await new AutoResponderService().prepareOverwrite({ ...entry, response: 'new' })).toBe('missing');
    expect(boundary.update).not.toHaveBeenCalled();
  });

  test('pending confirmations have a size limit and expired entries free space', async () => {
    vi.useFakeTimers();
    const service = new AutoResponderService();
    for (let i = 0; i < 1_000; i++) await service.prepareOverwrite({ ...entry, response: 'new' });
    expect(await service.prepareOverwrite({ ...entry, response: 'new' })).toBe('busy');
    vi.advanceTimersByTime(120_001);
    expect(await service.prepareOverwrite({ ...entry, response: 'new' })).toHaveProperty('token');
  });

  test.each(['add', 'remove', 'invalidate', 'shutdown'] as const)(
    '%s invalidation prevents an older pending read from repopulating the cache',
    async (action) => {
      let finish: (docs: AutoResponderDocument[]) => void = () => undefined;
      boundary.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const service = new AutoResponderService();
      const old = service.list('guild');
      if (action === 'add') await service.add(entry);
      else if (action === 'remove') await service.remove('guild', entry.trigger);
      else if (action === 'invalidate') service.invalidateGuild('guild');
      else service.shutdown();
      const updated = { ...entry, response: 'new' };
      boundary.read.mockResolvedValue([updated]);
      expect(await service.list('guild')).toEqual([updated]);
      finish([entry]);
      await old;
      expect(await service.list('guild')).toEqual([updated]);
      expect(boundary.read).toHaveBeenCalledTimes(2);
    }
  );
});
