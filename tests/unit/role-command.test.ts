import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { Guild, GuildMember, Message } from 'discord.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RoleToggleCommand } from '../../src/commands/moderation/role.js';
import { memberResolver } from '../../src/services/core/member-resolver.js';

describe('role command search work', () => {
  afterEach(() => vi.restoreAllMocks());

  test('does not issue member searches for splits with no matching role', async () => {
    const client = new SapphireClient({ intents: [], baseUserDirectory: null });
    const user = { id: '123456789012345678', username: 'owner', discriminator: '0', avatar: null };
    const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: user.id });
    client.guilds.cache.set(guild.id, guild);
    guild.members.cache.set(user.id, new GuildMember(client, { user, roles: [] }, guild));
    const source = new Message(client, {
      id: '123456789012345680',
      guild_id: guild.id,
      author: user,
      content: '!role alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: []
    });
    const reply = vi.spyOn(source, 'reply').mockResolvedValue(source);
    container.memberResolver = memberResolver;
    const search = vi
      .spyOn(memberResolver, 'resolve')
      .mockResolvedValue({ member: null, consumed: 0, confidence: null, reason: 'not_found' });
    const command = new RoleToggleCommand({
      name: 'role',
      root: process.cwd(),
      path: 'commands/moderation/role.ts',
      store: client.stores.get('commands')
    });
    await command.messageRun(source);
    expect(search).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
    await client.destroy();
  });
});
