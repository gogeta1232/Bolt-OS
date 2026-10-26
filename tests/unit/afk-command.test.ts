import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ChatInputCommandInteraction, Guild, GuildMember, Message } from 'discord.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AfkCommand } from '../../src/commands/utility/afk.js';
import { afkService } from '../../src/services/features/afk-service.js';

const media = vi.hoisted(() => ({ download: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/lib/remote-media.js', () => ({ downloadDiscordImage: media.download }));

const setup = (
  reason = 'working'
): {
  client: SapphireClient;
  command: AfkCommand;
  interaction: ChatInputCommandInteraction;
} => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test guild', owner_id: '123456789012345678' });
  client.guilds.cache.set(guild.id, guild);
  const user = { id: '123456789012345678', username: 'test', discriminator: '0', avatar: null };
  const memberData = { user, roles: [], joined_at: new Date(0).toISOString() };
  guild.members.cache.set(user.id, new GuildMember(client, memberData, guild));
  const interaction = new ChatInputCommandInteraction(client, {
    id: '123456789012345680',
    application_id: '123456789012345678',
    type: 2,
    token: 'unused-test-token',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8000000,
    guild_id: guild.id,
    member: memberData,
    data: {
      id: '123456789012345681',
      name: 'afk',
      type: 1,
      options: [{ name: 'set', type: 1, options: [{ name: 'message', type: 3, value: reason }] }]
    }
  });
  const command = new AfkCommand({
    name: 'afk',
    root: process.cwd(),
    path: 'commands/utility/afk.ts',
    store: client.stores.get('commands')
  });
  container.afk = afkService;
  return { client, command, interaction };
};

describe('AFK command network work', () => {
  afterEach(() => vi.restoreAllMocks());

  test('acknowledges before I/O, reads once and uses the atomic write result', async () => {
    const { client, command, interaction } = setup();
    const order: string[] = [];
    vi.spyOn(interaction, 'deferReply').mockImplementation(async () => {
      order.push('ack');
      interaction.deferred = true;
    });
    const edit = vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
    const fetch = vi.spyOn(afkService, 'fetch').mockImplementation(async () => {
      order.push('read');
      return null;
    });
    const set = vi.spyOn(afkService, 'set').mockImplementation(async () => {
      order.push('write');
      return { guildId: 'guild', userId: interaction.user.id, message: 'working', setAt: new Date(0) };
    });
    await command.chatInputRun(interaction);
    expect(order).toEqual(['ack', 'read', 'write']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  test('does not retry a failed image download in the same invocation', async () => {
    const url = 'https://cdn.discordapp.com/attachments/123456789012345678/123456789012345679/image.png';
    const { client, command, interaction } = setup(url);
    vi.spyOn(interaction, 'deferReply').mockImplementation(async () => {
      interaction.deferred = true;
    });
    vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
    vi.spyOn(afkService, 'fetch').mockResolvedValue(null);
    vi.spyOn(afkService, 'set').mockResolvedValue({
      guildId: 'guild',
      userId: interaction.user.id,
      message: url,
      attachmentUrl: url,
      setAt: new Date(0)
    });
    await command.chatInputRun(interaction);
    expect(media.download).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  test('reports a failed write without reading or claiming AFK was saved', async () => {
    const { client, command, interaction } = setup();
    vi.spyOn(interaction, 'deferReply').mockImplementation(async () => {
      interaction.deferred = true;
    });
    const edit = vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
    const fetch = vi.spyOn(afkService, 'fetch').mockResolvedValue(null);
    vi.spyOn(afkService, 'set').mockResolvedValue(null);
    await command.chatInputRun(interaction);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ content: 'Could not save your AFK status. Try again shortly.' });
    await client.destroy();
  });
});
