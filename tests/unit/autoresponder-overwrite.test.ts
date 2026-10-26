import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { ButtonInteraction, Guild, GuildMember, Message } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { AutoResponderOverwriteHandler } from '../../src/interaction-handlers/buttons/autoresponder-overwrite.js';
import * as permissions from '../../src/lib/permissions.js';
import { autoResponderService } from '../../src/services/features/autoresponder-service.js';
import { loggingService } from '../../src/services/core/logging-service.js';

afterEach(() => vi.restoreAllMocks());

const token = '12345678-1234-1234-1234-123456789012';

function setup(actorId = '123456789012345678') {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  const user = { id: actorId, username: 'owner', discriminator: '0', avatar: null };
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: '123456789012345678' });
  client.guilds.cache.set(guild.id, guild);
  const memberData = { user, roles: [], joined_at: new Date(0).toISOString() };
  const member = new GuildMember(client, memberData, guild);
  guild.members.cache.set(user.id, member);
  const interaction = new ButtonInteraction(client, {
    id: '123456789012345680',
    application_id: user.id,
    type: 3,
    token: 'unused-test-token',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8000000,
    guild_id: guild.id,
    member: memberData,
    data: { component_type: 2, custom_id: `autoresponder:overwrite:${token}` },
    message: {
      id: '123456789012345681',
      channel_id: '123456789012345682',
      author: user,
      content: '',
      timestamp: new Date(0).toISOString(),
      type: 0,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: []
    }
  });
  const handler = new AutoResponderOverwriteHandler(
    {
      name: 'autoresponder-overwrite',
      root: process.cwd(),
      path: 'interaction-handlers/buttons/autoresponder-overwrite.ts',
      store: client.stores.get('interaction-handlers')
    },
    {}
  );
  container.autoResponders = autoResponderService;
  container.logging = loggingService;
  const entry = {
    guildId: guild.id,
    trigger: 'trigger1',
    response: 'original',
    caseSensitive: false,
    useEmbed: false,
    createdBy: '123456789012345678',
    createdAt: new Date(0)
  };
  vi.spyOn(autoResponderService, 'getOverwrite').mockReturnValue({
    previous: entry,
    proposed: { ...entry, response: 'replacement' },
    expiresAt: Date.now() + 120_000
  });
  const order: string[] = [];
  vi.spyOn(interaction, 'deferUpdate').mockImplementation(async () => {
    order.push('ack');
    interaction.deferred = true;
  });
  const fetch = vi.spyOn(guild.members, 'fetch').mockImplementation(async () => {
    order.push('membership');
    return member;
  });
  const edit = vi.spyOn(interaction, 'editReply').mockResolvedValue(new Message(client, { id: interaction.id }));
  const audit = vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
  return { client, guild, interaction, handler, order, fetch, edit, audit };
}

test.each(['updated', 'cancelled', 'stale'] as const)(
  'confirmation handles %s and acknowledges before fresh authorization',
  async (result) => {
    const { client, guild, interaction, handler, order, fetch, edit, audit } = setup();
    try {
      const access = vi.spyOn(permissions, 'hasAdminAccess').mockResolvedValue(true);
      const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite').mockResolvedValue(result);
      await handler.run(interaction, { token, overwrite: result !== 'cancelled' });
      expect(order).toEqual(['ack', 'membership']);
      expect(fetch).toHaveBeenCalledWith({ user: interaction.user.id, force: true });
      expect(access).toHaveBeenCalledOnce();
      expect(resolve).toHaveBeenCalledWith(token, guild.id, interaction.user.id, result !== 'cancelled');
      expect(edit.mock.calls[0]?.[0]).toMatchObject({ components: [], allowedMentions: { parse: [] } });
      expect(audit).toHaveBeenCalledTimes(result === 'updated' ? 1 : 0);
    } finally {
      await client.destroy();
    }
  }
);

test('another user cannot confirm or cancel the request', async () => {
  const { client, interaction, handler, order } = setup('123456789012345683');
  try {
    const reply = vi.spyOn(interaction, 'reply').mockResolvedValue(undefined);
    const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite');
    await handler.run(interaction, { token, overwrite: true });
    expect(reply).toHaveBeenCalledOnce();
    expect(order).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    await client.destroy();
  }
});

test('revoked permissions prevent writes after the prompt was opened', async () => {
  const { client, interaction, handler } = setup();
  try {
    vi.spyOn(permissions, 'hasAdminAccess').mockResolvedValue(false);
    const follow = vi.spyOn(interaction, 'followUp').mockResolvedValue(new Message(client, { id: interaction.id }));
    const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite');
    await handler.run(interaction, { token, overwrite: true });
    expect(follow).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    await client.destroy();
  }
});

test('expired confirmations complete the interaction without a write', async () => {
  const { client, interaction, handler } = setup();
  try {
    vi.spyOn(autoResponderService, 'getOverwrite').mockReturnValue(undefined);
    const update = vi.spyOn(interaction, 'update').mockResolvedValue(undefined);
    const resolve = vi.spyOn(autoResponderService, 'resolveOverwrite');
    await handler.run(interaction, { token, overwrite: true });
    expect(update.mock.calls[0]?.[0]).toMatchObject({ components: [] });
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    await client.destroy();
  }
});

test('failed overwrites complete the deferred interaction without claiming success', async () => {
  const { client, interaction, handler, edit, audit } = setup();
  try {
    vi.spyOn(permissions, 'hasAdminAccess').mockResolvedValue(true);
    vi.spyOn(autoResponderService, 'resolveOverwrite').mockRejectedValue(new Error('offline'));
    await handler.run(interaction, { token, overwrite: true });
    expect(JSON.stringify(edit.mock.calls[0]?.[0])).toContain('Could not complete');
    expect(audit).not.toHaveBeenCalled();
  } finally {
    await client.destroy();
  }
});
