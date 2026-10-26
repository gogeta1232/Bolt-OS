import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { Guild, GuildMember, Message, TextChannel } from 'discord.js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';

import { SetJailChannelCommand } from '../../src/commands/admin/setjailchannel.js';
import { configService } from '../../src/services/core/config-service.js';
import { loggingService } from '../../src/services/core/logging-service.js';

afterEach(() => vi.restoreAllMocks());
const client = new SapphireClient({ intents: [], baseUserDirectory: null });
beforeAll(async () => {
  await client.stores.get('arguments').loadAll();
});
afterAll(async () => {
  await client.destroy();
});

test.each(['<#123456789012345680>', '123456789012345680', 'jail room'])(
  'prefix jail channel accepts the complete channel argument: %s',
  async (input) => {
    const owner = { id: '123456789012345678', username: 'owner', discriminator: '0', avatar: null };
    const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: owner.id });
    client.guilds.cache.set(guild.id, guild);
    guild.members.cache.set(
      owner.id,
      new GuildMember(client, { user: owner, roles: [], joined_at: new Date(0).toISOString() }, guild)
    );
    const channel = new TextChannel(guild, { id: '123456789012345680', name: 'jail room', type: 0 }, client);
    guild.channels.cache.set(channel.id, channel);
    client.channels.cache.set(channel.id, channel);
    const message = new Message(client, {
      id: '123456789012345681',
      channel_id: channel.id,
      guild_id: guild.id,
      author: owner,
      content: `!setjailchannel ${input}`,
      timestamp: new Date(0).toISOString(),
      type: 0,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: []
    });
    const command = new SetJailChannelCommand({
      name: 'setjailchannel',
      root: process.cwd(),
      path: 'commands/admin/setjailchannel.ts',
      store: client.stores.get('commands')
    });
    container.config = configService;
    container.logging = loggingService;
    const set = vi.spyOn(configService, 'set').mockResolvedValue({
      guildId: guild.id,
      prefix: '!',
      noPrefixMode: false,
      logChannels: {},
      adminRoleIds: [],
      modRoleIds: [],
      jailChannelId: channel.id
    });
    const send = vi.spyOn(channel, 'send').mockResolvedValue(message);
    vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
    const args = await command.messagePreParse(message, input, {
      commandName: 'setjailchannel',
      commandPrefix: '!',
      prefix: '!'
    });
    await command.messageRun(message, args);
    expect(set).toHaveBeenCalledWith(guild.id, { jailChannelId: channel.id });
    expect(send).toHaveBeenCalledOnce();
  }
);
