import { SapphireClient, container } from '@sapphire/framework';
import { ClientUser, Guild, GuildMember, Message, PermissionsBitField, TextChannel, User } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import type { LogContext } from '../../src/config/logging.js';
import { configService } from '../../src/services/core/config-service.js';
import { LoggingService } from '../../src/services/core/logging-service.js';

vi.mock('@sapphire/framework', async () =>
  vi.importActual<typeof import('@sapphire/framework')>('@sapphire/framework')
);

const clients: SapphireClient[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(clients.splice(0).map((client) => client.destroy()));
});

const fixture = () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  clients.push(client);
  const bot = { id: '900000000000000001', username: 'Bolt', bot: true };
  client.user = new ClientUser(client, bot);
  const guild = new Guild(client, { id: '100000000000000001', name: 'Test' });
  client.guilds.cache.set(guild.id, guild);
  guild.members.cache.set(bot.id, new GuildMember(client, { user: bot, roles: [] }, guild));
  const channel = new TextChannel(guild, { id: '200000000000000001', type: 0, name: 'logs' }, client);
  guild.channels.cache.set(channel.id, channel);
  vi.spyOn(guild.channels, 'fetch').mockResolvedValue(channel);
  vi.spyOn(channel, 'permissionsFor').mockReturnValue(new PermissionsBitField(['SendMessages', 'EmbedLinks']));
  const delivered = new Message<true>(client, {
    id: '600000000000000001',
    guild_id: guild.id,
    channel_id: channel.id,
    author: bot,
    content: 'Log card'
  });
  const send = vi.spyOn(channel, 'send').mockResolvedValue(delivered);
  container.config = configService;
  const config = vi.spyOn(configService, 'fetch').mockResolvedValue({
    guildId: guild.id,
    prefix: '!',
    adminRoleIds: [],
    modRoleIds: [],
    logChannels: { message: channel.id }
  });
  vi.spyOn(container.logger, 'error').mockImplementation(() => undefined);
  const service = new LoggingService();
  const author = new User(client, { id: '400000000000000001', username: 'Spec', bot: true });
  const context = (revision: string, id = '300000000000000001'): LogContext => ({
    target: author,
    channel: { id: channel.id },
    message: { id, revision }
  });
  return { service, guild, send, context, config, client };
};

test('concurrent and repeated deliveries of the same state send a single log', async () => {
  const { service, guild, send, context } = fixture();
  await Promise.all(Array.from({ length: 10 }, () => service.sendMessageEditLog(guild, 'Body', context('A'))));
  await service.sendMessageEditLog(guild, 'Same body with a refreshed event time', context('A'));
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toMatchObject({ allowedMentions: { parse: [], users: [], roles: [] } });
});

test('real reversals and independent message edits are not suppressed', async () => {
  const { service, guild, send, context } = fixture();
  for (const state of ['A', 'B', 'A', 'B']) await service.sendMessageEditLog(guild, state, context(state));
  await service.sendMessageEditLog(guild, 'B', context('B', '300000000000000002'));
  expect(send).toHaveBeenCalledTimes(5);
});

test('a failed send releases its reservation so a later delivery can retry', async () => {
  const { service, guild, send, context } = fixture();
  send.mockRejectedValueOnce(new Error('Discord unavailable'));
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  expect(send).toHaveBeenCalledTimes(2);
});

test('a delayed failure never removes the reservation for a newer successful edit', async () => {
  const { service, guild, send, context } = fixture();
  let rejectFirst: (reason: Error) => void = () => undefined;
  send.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectFirst = reject;
    })
  );
  const first = service.sendMessageEditLog(guild, 'A', context('A'));
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  await service.sendMessageEditLog(guild, 'B', context('B'));
  rejectFirst(new Error('Earlier send failed'));
  await first;
  await service.sendMessageEditLog(guild, 'B', context('B'));
  expect(send).toHaveBeenCalledTimes(2);
});

test('duplicate state expires and guild removal or shutdown invalidates it', async () => {
  const { service, guild, send, context } = fixture();
  vi.useFakeTimers();
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  vi.advanceTimersByTime(60_001);
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  service.invalidateGuild(guild.id);
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  service.shutdown();
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  expect(send).toHaveBeenCalledTimes(4);
});

test('Bolt-authored logs are rejected at the shared boundary before configuration lookup', async () => {
  const { service, guild, send, context, config, client } = fixture();
  const ownContext = { ...context('A'), target: client.user };
  await service.sendMessageEditLog(guild, 'Nested log', ownContext);
  await service.sendMessageDeleteLog(guild, 'Deleted log', ownContext);
  expect(config).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('deletion duplicates are suppressed independently from edit events', async () => {
  const { service, guild, send, context } = fixture();
  await service.sendMessageEditLog(guild, 'Body', context('A'));
  await service.sendMessageDeleteLog(guild, 'Body', context('A'));
  await service.sendMessageDeleteLog(guild, 'Body', context('A'));
  expect(send).toHaveBeenCalledTimes(2);
});

test('the bounded cache evicts old message identities while retaining recent duplicates', async () => {
  const { service, guild, send, context } = fixture();
  for (let index = 0; index <= 2000; index++) {
    await service.sendMessageEditLog(guild, 'Body', context('A', String(300000000000000000n + BigInt(index))));
  }
  await service.sendMessageEditLog(guild, 'Body', context('A', '300000000000002000'));
  expect(send).toHaveBeenCalledTimes(2001);
  await service.sendMessageEditLog(guild, 'Body', context('A', '300000000000000000'));
  expect(send).toHaveBeenCalledTimes(2002);
});
