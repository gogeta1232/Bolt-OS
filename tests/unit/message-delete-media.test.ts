import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ClientUser, Guild, Message, TextChannel } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { buildLogV2Container } from '../../src/config/logging.js';
import { MessageDeleteListener } from '../../src/listeners/guild/messages/message-delete.js';
import { loggingService } from '../../src/services/core/logging-service.js';

const clients: SapphireClient[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.destroy()));
});

const fixture = () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  clients.push(client);
  client.user = new ClientUser(client, { id: '900000000000000001', username: 'Bolt', bot: true });
  const guild = new Guild(client, { id: '100000000000000001', name: 'Test' });
  client.guilds.cache.set(guild.id, guild);
  const channel = new TextChannel(guild, { id: '200000000000000001', type: 0, name: 'test' }, client);
  const url = 'https://cdn.discordapp.com/attachments/1/2/image.png';
  const proxy = 'https://media.discordapp.net/attachments/1/2/image.png';
  const message = new Message(client, {
    id: '300000000000000001',
    guild_id: guild.id,
    channel_id: channel.id,
    author: { id: '400000000000000001', username: 'Bot', bot: true },
    content: '',
    attachments: [{ id: '500000000000000001', filename: 'image.png', size: 5, url, proxy_url: proxy }],
    embeds: [],
    timestamp: '2026-10-16T00:00:00Z'
  });
  guild.channels.cache.set(channel.id, channel);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response('image', { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetch);
  container.logging = loggingService;
  const send = vi.spyOn(loggingService, 'sendMessageDeleteLog').mockResolvedValue(undefined);
  const listener = new MessageDeleteListener({
    name: 'message-delete',
    root: process.cwd(),
    path: 'listeners/guild/messages/message-delete.ts',
    store: client.stores.get('listeners')
  });
  return { listener, message, fetch, send, proxy };
};
let current: ReturnType<typeof fixture>;
beforeEach(() => {
  current = fixture();
});

test('reuploads an image with missing content type using its proxy after a failed download', async () => {
  const { listener, message, fetch, send, proxy } = current;
  await listener.run(message);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[1]?.[0])).toBe(proxy);
  const context = send.mock.calls[0]?.[2];
  expect(context?.files).toHaveLength(1);
  const file = context?.files?.[0];
  expect(file?.attachment).toEqual(Buffer.from('image'));
  const payload = buildLogV2Container('messageDelete', '', context);
  expect(JSON.stringify(payload.components[0].toJSON())).toContain(`attachment://${file?.name}`);
});

test('still sends the deletion log when both image URLs are unavailable', async () => {
  const { listener, message, fetch, send } = current;
  fetch.mockReset().mockImplementation(() => Promise.resolve(new Response(null, { status: 404 })));
  await listener.run(message);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[2]?.files).toBeUndefined();
});

test('does not discard an image solely because its URL has no image extension', async () => {
  const { listener, message, send } = current;
  const attachment = message.attachments.first();
  if (!attachment) throw new Error('Missing fixture attachment');
  attachment.name = 'upload';
  attachment.url = 'https://cdn.discordapp.com/attachments/1/2/upload';
  attachment.contentType = 'image/png';
  await listener.run(message);
  expect(send.mock.calls[0]?.[2]?.files?.[0]?.name).toMatch(/\.png$/);
});

test('uncached deletions do not fetch a deleted message or spam empty log cards', async () => {
  const { listener, message, send, fetch } = current;
  message.attachments.clear();
  message.content = '';
  vi.spyOn(message, 'partial', 'get').mockReturnValue(true);
  const fetchMessage = vi.spyOn(message, 'fetch').mockRejectedValue(new Error('Unknown Message'));
  for (let index = 0; index < 10; index++) await listener.run(message);
  expect(send).not.toHaveBeenCalled();
  expect(fetchMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('cached text deletions still retain the captured content', async () => {
  const { listener, message, send } = current;
  message.attachments.clear();
  message.content = 'Captured message';
  await listener.run(message);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toContain('Captured message');
});

test('deleting Bolt log cards does not generate more logs or media downloads', async () => {
  const { listener, message, fetch, send } = current;
  const bot = message.client.user;
  if (!bot) throw new Error('Missing bot fixture');
  message.author = bot;
  await listener.run(message);
  expect(send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
