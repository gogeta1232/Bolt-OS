import { SapphireClient } from '@sapphire/framework';
import { ChatInputCommandInteraction, Guild, GuildMember } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { WarnCommand } from '../../src/commands/moderation/warn.js';

afterEach(() => vi.restoreAllMocks());

test('warning issue acknowledges with a valid modal before external work', async () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  const ownerId = '123456789012345678';
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: ownerId });
  client.guilds.cache.set(guild.id, guild);
  const owner = { id: ownerId, username: 'owner', discriminator: '0', avatar: null };
  const target = { id: '123456789012345680', username: 'target', discriminator: '0', avatar: null };
  const memberData = { user: owner, roles: [], joined_at: new Date(0).toISOString() };
  guild.members.cache.set(ownerId, new GuildMember(client, memberData, guild));
  const interaction = new ChatInputCommandInteraction(client, {
    id: '123456789012345681',
    application_id: ownerId,
    type: 2,
    token: 'unused-test-token',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8000000,
    guild_id: guild.id,
    member: memberData,
    data: {
      id: '123456789012345682',
      name: 'warn',
      type: 1,
      options: [{ name: 'issue', type: 1, options: [{ name: 'target', type: 6, value: target.id }] }],
      resolved: {
        users: { [target.id]: target },
        members: { [target.id]: { roles: [], joined_at: new Date(0).toISOString() } }
      }
    }
  });
  const command = new WarnCommand({
    name: 'warn',
    root: process.cwd(),
    path: 'commands/moderation/warn.ts',
    store: client.stores.get('commands')
  });
  const modal = vi.spyOn(interaction, 'showModal').mockResolvedValue(undefined);
  const defer = vi.spyOn(interaction, 'deferReply');
  try {
    await command.chatInputRun(interaction);
    expect(modal).toHaveBeenCalledOnce();
    // Serialize with the real builder: this rejects labels outside Discord's limits.
    const payload = modal.mock.calls[0]?.[0];
    expect(payload && 'toJSON' in payload ? payload.toJSON() : payload).toMatchObject({
      title: 'Warn target',
      components: [
        { components: [{ custom_id: 'reason' }] },
        { components: [{ custom_id: 'duration', label: 'Duration (optional, e.g. 3 days)' }] }
      ]
    });
    expect(defer).not.toHaveBeenCalled();
  } finally {
    await client.destroy();
  }
});
