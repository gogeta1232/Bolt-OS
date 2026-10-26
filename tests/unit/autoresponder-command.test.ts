import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ChatInputCommandInteraction, Guild, GuildMember, Message, MessageFlags, TextChannel } from 'discord.js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';

import { AutoResponderCommand } from '../../src/commands/admin/autoresponder.js';
import { autoResponderService } from '../../src/services/features/autoresponder-service.js';
import { loggingService } from '../../src/services/core/logging-service.js';

afterEach(() => vi.restoreAllMocks());
const testClient = new SapphireClient({ intents: [], baseUserDirectory: null });
beforeAll(async () => {
  await testClient.stores.get('arguments').loadAll();
});
afterAll(async () => {
  await testClient.destroy();
});

function setup(): {
  client: SapphireClient;
  command: AutoResponderCommand;
  interaction: ChatInputCommandInteraction;
} {
  const client = testClient;
  const user = { id: '123456789012345678', username: 'owner', discriminator: '0', avatar: null };
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: user.id });
  client.guilds.cache.set(guild.id, guild);
  const member = { user, roles: [], joined_at: new Date(0).toISOString() };
  guild.members.cache.set(user.id, new GuildMember(client, member, guild));
  const interaction = new ChatInputCommandInteraction(client, {
    id: '123456789012345680',
    application_id: user.id,
    type: 2,
    token: 'unused-test-token',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8000000,
    guild_id: guild.id,
    member,
    data: {
      id: '123456789012345681',
      name: 'autoresponder',
      type: 1,
      options: [
        {
          name: 'add',
          type: 1,
          options: [
            { name: 'trigger', type: 3, value: 'trigger1' },
            { name: 'response', type: 3, value: 'replacement' }
          ]
        }
      ]
    }
  });
  const command = new AutoResponderCommand({
    name: 'autoresponder',
    root: process.cwd(),
    path: 'commands/admin/autoresponder.ts',
    store: client.stores.get('commands')
  });
  container.autoResponders = autoResponderService;
  container.logging = loggingService;
  return { client, command, interaction };
}

test.each(['added', 'exists', 'failure'] as const)('slash add completes its deferred reply on %s', async (result) => {
  const { client, command, interaction } = setup();
  try {
    const order: string[] = [];
    const defer = vi.spyOn(interaction, 'deferReply').mockImplementation(async () => {
      order.push('ack');
      interaction.deferred = true;
      interaction.ephemeral = true;
    });
    const edit = vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
    const add = vi.spyOn(autoResponderService, 'add').mockImplementation(async () => {
      order.push('write');
      if (result === 'failure') throw new Error('database unavailable');
      return result;
    });
    const audit = vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
    vi.spyOn(autoResponderService, 'prepareOverwrite').mockResolvedValue('same');
    await command.chatInputRun(interaction);
    expect(order).toEqual(['ack', 'write']);
    expect(defer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(add).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
    const payload = edit.mock.calls[0]?.[0];
    const description = JSON.stringify(payload);
    expect(description).toContain(
      result === 'added' ? 'Responder added' : result === 'exists' ? 'already exists' : 'Could not add'
    );
    expect(payload).toMatchObject({ allowedMentions: { parse: [], repliedUser: false } });
    expect(audit).toHaveBeenCalledTimes(result === 'added' ? 1 : 0);
  } finally {
    client.guilds.cache.clear();
  }
});

test('a different response shows overwrite controls without writing it', async () => {
  const { client, command, interaction } = setup();
  try {
    vi.spyOn(interaction, 'deferReply').mockImplementation(async () => {
      interaction.deferred = true;
      interaction.ephemeral = true;
    });
    const edit = vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
    vi.spyOn(autoResponderService, 'add').mockResolvedValue('exists');
    vi.spyOn(autoResponderService, 'prepareOverwrite').mockResolvedValue({ token: 'confirmation-token' });
    const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite');
    const audit = vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
    await command.chatInputRun(interaction);
    const payload = JSON.stringify(edit.mock.calls[0]?.[0]);
    expect(payload).toContain('Overwrite the existing response');
    expect(payload).toContain('replacement');
    expect(payload).toContain('autoresponder:overwrite:confirmation-token');
    expect(payload).toContain('autoresponder:cancel:confirmation-token');
    expect(resolve).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  } finally {
    client.guilds.cache.clear();
  }
});

test.each(['same', 'different'] as const)('prefix add handles a %s response without overwriting', async (response) => {
  const { client, command, interaction } = setup();
  try {
    const guild = interaction.guild;
    if (!guild) throw new Error('Expected test guild');
    const channel = new TextChannel(guild, { id: '123456789012345682', name: 'test', type: 0 }, client);
    guild.channels.cache.set(channel.id, channel);
    client.channels.cache.set(channel.id, channel);
    const message = new Message(client, {
      id: '123456789012345683',
      channel_id: channel.id,
      guild_id: guild.id,
      author: { id: interaction.user.id, username: 'owner', discriminator: '0', avatar: null },
      content: '!autoresponder add trigger1 replacement',
      timestamp: new Date(0).toISOString(),
      type: 0,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: []
    });
    const send = vi.spyOn(channel, 'send').mockResolvedValue(message);
    vi.spyOn(autoResponderService, 'add').mockResolvedValue('exists');
    vi.spyOn(autoResponderService, 'prepareOverwrite').mockResolvedValue(
      response === 'same' ? 'same' : { token: 'confirmation-token' }
    );
    const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite');
    const args = await command.messagePreParse(message, 'add trigger1 replacement', {
      commandName: 'autoresponder',
      commandPrefix: '!',
      prefix: '!'
    });
    await command.messageRun(message, args);
    const payload = JSON.stringify(send.mock.calls[0]?.[0]);
    expect(payload).toContain(response === 'same' ? 'same response' : 'Overwrite the existing response');
    expect(payload.includes('autoresponder:overwrite:')).toBe(response === 'different');
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    client.guilds.cache.clear();
  }
});
