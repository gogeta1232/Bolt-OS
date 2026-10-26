import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ClientUser, Guild, Message, TextChannel, type APIMessageComponent, MessageFlags } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { buildLogV2Container } from '../../src/config/logging.js';
import { MessageUpdateListener } from '../../src/listeners/guild/messages/message-update.js';
import { loggingService } from '../../src/services/core/logging-service.js';
import { SnipeService } from '../../src/services/features/snipe-service.js';

const clients: SapphireClient[] = [];
afterEach(async () => {
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
  guild.channels.cache.set(channel.id, channel);
  client.channels.cache.set(channel.id, channel);
  const message = (content: string | null, components: APIMessageComponent[] = [], embed = false): Message =>
    new Message(client, {
      id: '300000000000000001',
      guild_id: guild.id,
      channel_id: channel.id,
      author: { id: '400000000000000001', username: 'Spec', bot: true },
      content,
      attachments: [],
      embeds: embed ? [{ title: 'Pong!', fields: [{ name: 'API latency', value: '42ms' }] }] : [],
      components,
      flags: components.length ? MessageFlags.IsComponentsV2 : 0,
      timestamp: '2026-10-25T00:00:00Z'
    });
  container.logging = loggingService;
  container.snipe = new SnipeService();
  const send = vi.spyOn(loggingService, 'sendMessageEditLog').mockResolvedValue(undefined);
  const listener = new MessageUpdateListener({
    name: 'message-update',
    root: process.cwd(),
    path: 'listeners/guild/messages/message-update.ts',
    store: client.stores.get('listeners')
  });
  return { message, send, listener, client, guild, channel };
};

const pingComponents = (text: string): APIMessageComponent[] => [
  { type: 17, components: [{ type: 10, content: text }] }
];

test.each(['embed', 'components'])('loading text replaced by %s shows the ping result', async (kind) => {
  const { message, send, listener } = fixture();
  const before = message('Measuring latency...');
  const after = message('', kind === 'components' ? pingComponents('Pong! API latency: 42ms') : [], kind === 'embed');
  await listener.run(before, after);
  expect(send).toHaveBeenCalledOnce();
  const description = send.mock.calls[0]?.[1] ?? '';
  const context = send.mock.calls[0]?.[2];
  const payload = JSON.stringify(buildLogV2Container('messageEdit', description, context).components[0].toJSON());
  expect(payload).toContain('Measuring latency...');
  expect(payload).toContain('Pong!');
  expect(payload).toContain('42ms');
  expect(payload).not.toContain('No content');
});

test('component-only edits show both bodies and identical updates send no log', async () => {
  const { message, send, listener } = fixture();
  const before = message('', pingComponents('API latency: 42ms'));
  const after = message('', pingComponents('API latency: 65ms'));
  await listener.run(before, after);
  expect(send.mock.calls[0]?.[1]).toContain('42ms');
  expect(send.mock.calls[0]?.[1]).toContain('65ms');
  send.mockClear();
  await listener.run(after, after);
  expect(send).not.toHaveBeenCalled();
});

test('an unknown previous body is not fetched and presented as before evidence', async () => {
  const { message, send, listener } = fixture();
  const before = message(null);
  const after = message('Current body');
  const fetch = vi.spyOn(before, 'fetch').mockResolvedValue(after);
  await listener.run(before, after);
  expect(fetch).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('long component bodies retain the complete component evidence in an attachment', async () => {
  const { message, send, listener } = fixture();
  const fullText = 'Start ' + 'x'.repeat(1800) + ' end of result';
  await listener.run(message('Loading...'), message('', pingComponents(fullText)));
  const files = send.mock.calls[0]?.[2]?.files ?? [];
  expect(files.some((file) => file.attachment.toString().includes(fullText))).toBe(true);
  expect((send.mock.calls[0]?.[1] ?? '').length).toBeLessThan(3500);
});

test('multiline text previews remain bounded and retain unabridged evidence', async () => {
  const { message, send, listener } = fixture();
  const content = 'a\n'.repeat(550);
  await listener.run(message(content), message('Updated'));
  expect((send.mock.calls[0]?.[1] ?? '').length).toBeLessThan(3500);
  const files = send.mock.calls[0]?.[2]?.files ?? [];
  expect(files.some((file) => file.attachment.toString().includes(content))).toBe(true);
});

test('Bolt never logs changes to its own log cards, including media hydration updates', async () => {
  const { message, listener, send, client } = fixture();
  const body = buildLogV2Container('messageEdit', '**Before:** old\n**After:** new');
  const before = message(
    '',
    body.components.map((component) => component.toJSON())
  );
  const after = message('', pingComponents('Message Edited: nested log content'));
  if (!client.user) throw new Error('Missing bot fixture');
  before.author = client.user;
  after.author = client.user;
  const fetch = vi.spyOn(after, 'fetch');
  await listener.run(before, after);
  expect(send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('Discord-assigned component IDs and media loading metadata do not create edit logs', async () => {
  const { message, listener, send } = fixture();
  const image = 'https://example.com/image.png';
  const before = message('', [
    {
      type: 17,
      components: [
        { type: 10, content: 'A result' },
        { type: 12, items: [{ media: { url: image } }] }
      ]
    }
  ]);
  const after = message('', [
    {
      type: 17,
      id: 100,
      components: [
        { type: 10, id: 101, content: 'A result' },
        {
          type: 12,
          id: 102,
          items: [
            {
              media: {
                url: image,
                proxy_url: 'https://media.discordapp.net/external/proxy.png',
                width: 100,
                height: 100,
                content_type: 'image/png',
                placeholder: 'hash',
                loading_state: 2
              }
            }
          ]
        }
      ]
    }
  ]);
  await listener.run(before, after);
  expect(send).not.toHaveBeenCalled();
});

test('internal button routing changes are ignored, but disabling a control is logged', async () => {
  const { message, listener, send } = fixture();
  const button = (customId: string, disabled = false): APIMessageComponent[] => [
    { type: 1, components: [{ type: 2, style: 1, label: 'Next page', custom_id: customId, disabled }] }
  ];
  await listener.run(message('', button('old')), message('', button('new')));
  expect(send).not.toHaveBeenCalled();
  await listener.run(message('', button('new')), message('', button('new', true)));
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toContain('Next page (disabled)');
});

test('replacing an attachment with the same attachment count shows the new file', async () => {
  const { listener, send, client, guild, channel } = fixture();
  const withFile = (id: string, filename: string): Message =>
    new Message(client, {
      id: '300000000000000001',
      guild_id: guild.id,
      channel_id: channel.id,
      author: { id: '400000000000000001', username: 'Spec', bot: true },
      content: '',
      embeds: [],
      attachments: [{ id, filename, size: 1, url: `https://cdn.discordapp.com/attachments/1/${id}/${filename}` }]
    });
  await listener.run(withFile('500000000000000001', 'old.txt'), withFile('500000000000000002', 'new.txt'));
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toContain('old.txt');
  expect(send.mock.calls[0]?.[1]).toContain('new.txt');
});

test('a member link-preview refresh without an edit is ignored', async () => {
  const { message, listener, send } = fixture();
  const before = message('https://example.com');
  const after = message('https://example.com', [], true);
  before.author.bot = false;
  after.author.bot = false;
  await listener.run(before, after);
  expect(send).not.toHaveBeenCalled();
});

test('a bot edit in a log channel remains eligible when it is not authored by Bolt', async () => {
  const { message, listener, send } = fixture();
  await listener.run(message('Loading...'), message('Result'));
  expect(send).toHaveBeenCalledOnce();
});

test('real member edits still log and preserve edit-snipe evidence', async () => {
  const { message, listener, send } = fixture();
  const before = message('Original text');
  const after = message('Edited text');
  before.author.bot = false;
  after.author.bot = false;
  const store = vi.spyOn(container.snipe, 'storeEditedMessage');
  await listener.run(before, after);
  expect(send).toHaveBeenCalledOnce();
  expect(store).toHaveBeenCalledWith(before, after);
  expect(send.mock.calls[0]?.[1]).toContain('Original text');
  expect(send.mock.calls[0]?.[1]).toContain('Edited text');
});

test('same-name sticker replacements retain the changed identities instead of an empty card', async () => {
  const { message, listener, send, client } = fixture();
  const before = message('');
  const after = message('');
  const beforeWithSticker = new Message(client, {
    id: before.id,
    guild_id: before.guildId,
    channel_id: before.channelId,
    author: { id: before.author.id, username: 'Spec', bot: true },
    content: '',
    embeds: [],
    attachments: [],
    sticker_items: [{ id: '700000000000000001', name: 'Wave', format_type: 1 }]
  });
  const afterWithSticker = new Message(client, {
    id: after.id,
    guild_id: after.guildId,
    channel_id: after.channelId,
    author: { id: after.author.id, username: 'Spec', bot: true },
    content: '',
    embeds: [],
    attachments: [],
    sticker_items: [{ id: '700000000000000002', name: 'Wave', format_type: 1 }]
  });
  await listener.run(beforeWithSticker, afterWithSticker);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toContain('700000000000000001');
  expect(send.mock.calls[0]?.[1]).toContain('700000000000000002');
});
