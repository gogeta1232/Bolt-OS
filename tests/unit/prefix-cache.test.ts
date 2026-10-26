import { container } from '@sapphire/pieces';
import { Guild, Message } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { GuildConfigDocument } from '../../src/database/models/guild/GuildConfig.js';
import { BotClient } from '../../src/lib/bot-client.js';
import { configService } from '../../src/services/core/config-service.js';
import { autoResponderService } from '../../src/services/features/autoresponder-service.js';
import { loggingService } from '../../src/services/core/logging-service.js';

vi.mock('@sapphire/framework', async () =>
  vi.importActual<typeof import('@sapphire/framework')>('@sapphire/framework')
);
const boundary = vi.hoisted(() => ({ query: vi.fn<() => Promise<GuildConfigDocument | null>>() }));
vi.mock('../../src/database/models/guild/GuildConfig.js', () => ({
  GuildConfigModel: { findOneAndUpdate: () => ({ lean: () => ({ exec: boundary.query }) }) }
}));
const guildId = '123456789012345679';
const config = (prefix: string): GuildConfigDocument => ({
  guildId,
  prefix,
  logChannels: {},
  adminRoleIds: [],
  modRoleIds: []
});
beforeEach(() => {
  configService.deleteFromCache(guildId);
  boundary.query.mockReset().mockResolvedValue(config('?'));
  container.config = configService;
  container.autoResponders = autoResponderService;
  container.logging = loggingService;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('warm prefix hook returns synchronously and follows persisted prefix writes', async () => {
  const client = new BotClient({ intents: [], baseUserDirectory: null, defaultPrefix: '!' });
  const guild = new Guild(client, { id: guildId, name: 'Test' });
  client.guilds.cache.set(guildId, guild);
  const message = new Message(client, { id: '123456789012345680', guild_id: guildId });
  try {
    expect(await client.fetchPrefix(message)).toBe('?');
    expect(client.fetchPrefix(message)).toBe('?');
    expect(boundary.query).toHaveBeenCalledOnce();
    boundary.query.mockResolvedValue(config('$'));
    await configService.set(guildId, { prefix: '$' });
    expect(client.fetchPrefix(message)).toBe('$');
    expect(await client.getGuildPrefix(guildId)).toBe('$');
    const invalidate = vi.spyOn(autoResponderService, 'invalidateGuild');
    const invalidateLogs = vi.spyOn(loggingService, 'invalidateGuild');
    client.emit('guildDelete', guild);
    expect(configService.getCached(guildId)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(guildId);
    expect(invalidateLogs).toHaveBeenCalledWith(guildId);
  } finally {
    await client.destroy();
  }
});

test('prefix configuration expires after five minutes', async () => {
  vi.useFakeTimers();
  await configService.fetch(guildId);
  expect(configService.getCached(guildId)?.prefix).toBe('?');
  vi.advanceTimersByTime(300_001);
  expect(configService.getCached(guildId)).toBeNull();
  boundary.query.mockResolvedValue(config('$'));
  expect((await configService.fetch(guildId)).prefix).toBe('$');
  expect(boundary.query).toHaveBeenCalledTimes(2);
});

test.each(['write', 'remove'] as const)('%s prevents an older lookup repopulating configuration', async (action) => {
  let finish: (value: GuildConfigDocument) => void = () => undefined;
  boundary.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const old = configService.fetch(guildId);
  if (action === 'write') {
    boundary.query.mockResolvedValue(config('$'));
    await configService.set(guildId, { prefix: '$' });
  } else configService.deleteFromCache(guildId);
  finish(config('?'));
  await old;
  expect(configService.getCached(guildId)?.prefix ?? null).toBe(action === 'write' ? '$' : null);
});

test('concurrent cold prefix reads still share one database query', async () => {
  await Promise.all(Array.from({ length: 20 }, () => configService.fetch(guildId)));
  expect(boundary.query).toHaveBeenCalledOnce();
});

test('an invalidated lookup cannot remove a newer pending lookup', async () => {
  let finishOld: (value: GuildConfigDocument) => void = () => undefined;
  let finishNew: (value: GuildConfigDocument) => void = () => undefined;
  boundary.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  boundary.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNew = resolve;
      })
  );
  const old = configService.fetch(guildId);
  configService.deleteFromCache(guildId);
  const newer = configService.fetch(guildId);
  finishOld(config('?'));
  await old;
  const overlapping = configService.fetch(guildId);
  expect(boundary.query).toHaveBeenCalledTimes(2);
  finishNew(config('$'));
  await Promise.all([newer, overlapping]);
  expect(configService.getCached(guildId)?.prefix).toBe('$');
});
