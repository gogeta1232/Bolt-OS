import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ClientUser, Collection, Guild, Message, TextChannel } from 'discord.js';
import { writeFile } from 'fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

import { MessageBulkDeleteListener } from '../../src/listeners/guild/messages/message-bulk-delete.js';
import { loggingService } from '../../src/services/core/logging-service.js';

vi.mock('fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
const clients: SapphireClient[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.destroy()));
});

const fixture = () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  clients.push(client);
  const bot = { id: '900000000000000001', username: 'Bolt', bot: true };
  client.user = new ClientUser(client, bot);
  const guild = new Guild(client, { id: '100000000000000001', name: 'Test' });
  client.guilds.cache.set(guild.id, guild);
  const channel = new TextChannel(guild, { id: '200000000000000001', type: 0, name: 'logs' }, client);
  client.channels.cache.set(channel.id, channel);
  const message = (id: string, own: boolean): Message =>
    new Message(client, {
      id,
      guild_id: guild.id,
      channel_id: channel.id,
      content: own ? 'Bolt log card' : 'Other message',
      author: own ? bot : { id: '400000000000000001', username: 'Member', bot: false },
      attachments: [],
      embeds: [],
      stickers: []
    });
  container.logging = loggingService;
  const send = vi.spyOn(loggingService, 'sendMessageDeleteLog').mockResolvedValue(undefined);
  const listener = new MessageBulkDeleteListener({
    name: 'message-bulk-delete',
    root: process.cwd(),
    path: 'listeners/guild/messages/message-bulk-delete.ts',
    store: client.stores.get('listeners')
  });
  return { message, listener, send };
};

test('purging only Bolt log cards sends no replacement logs', async () => {
  const { message, listener, send } = fixture();
  const own = message('300000000000000001', true);
  await listener.run(new Collection([[own.id, own]]));
  expect(send).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

test('a mixed bulk deletion sends one summary and excludes Bolt cards from its evidence', async () => {
  const { message, listener, send } = fixture();
  const own = message('300000000000000001', true);
  const other = message('300000000000000002', false);
  await listener.run(
    new Collection([
      [own.id, own],
      [other.id, other]
    ])
  );
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toContain('1 messages');
  const transcript = send.mock.calls[0]?.[2]?.files?.[0]?.attachment.toString();
  expect(transcript).toContain(other.id);
  expect(transcript).not.toContain(own.id);
});
