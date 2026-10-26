import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { Guild, GuildMember, Message, Role, TextChannel, User } from 'discord.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { GuildMemberUpdateListener } from '../../src/listeners/guild/members/guild-member-update.js';
import { NickCommand } from '../../src/commands/moderation/nick.js';
import { UserUpdateListener } from '../../src/listeners/user-update.js';
import { loggingService } from '../../src/services/core/logging-service.js';
import { memberResolver } from '../../src/services/core/member-resolver.js';

let sequence = 0;
const clients: SapphireClient[] = [];
const fixture = () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  clients.push(client);
  const guildId = String(100000000000000000n + BigInt(++sequence));
  const userId = String(200000000000000000n + BigInt(sequence));
  const guild = new Guild(client, { id: guildId, name: 'Test' });
  client.guilds.cache.set(guild.id, guild);
  guild.roles.cache.set(guild.id, new Role(client, { id: guild.id, name: '@everyone', permissions: '0' }, guild));
  container.logging = loggingService;
  container.memberResolver = memberResolver;
  const send = vi.spyOn(loggingService, 'sendMemberUpdateLog').mockResolvedValue(undefined);
  const invalidate = vi.spyOn(memberResolver, 'invalidateGuild');
  const userListener = new UserUpdateListener({
    name: 'user-update',
    root: process.cwd(),
    path: 'listeners/user-update.ts',
    store: client.stores.get('listeners')
  });
  const memberListener = new GuildMemberUpdateListener({
    name: 'guild-member-update',
    root: process.cwd(),
    path: 'listeners/guild/members/guild-member-update.ts',
    store: client.stores.get('listeners')
  });
  const member = (bot: boolean, nick: string | null, avatar: string, roles: string[] = []): GuildMember =>
    new GuildMember(
      client,
      { user: { id: userId, username: 'Account', bot }, nick, avatar, roles, joined_at: '2026-01-01T00:00:00Z' },
      guild
    );
  return { client, guild, userId, send, invalidate, userListener, memberListener, member };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.destroy()));
});

describe('bot profile logging exclusions', () => {
  test.each([true, false])('global name/avatar changes are logged only for humans (bot=%s)', async (bot) => {
    const f = fixture();
    guildMemberInCache(f, bot);
    const before = new User(f.client, {
      id: f.userId,
      username: 'Before',
      global_name: 'Old display',
      avatar: 'a'.repeat(32),
      bot
    });
    const after = new User(f.client, {
      id: f.userId,
      username: 'After',
      global_name: 'New display',
      avatar: 'b'.repeat(32),
      bot
    });
    vi.spyOn(after, 'fetch').mockResolvedValue(after);
    await f.userListener.run(before, after);
    expect(f.invalidate).toHaveBeenCalledWith(f.guild.id);
    if (bot) expect(f.send).not.toHaveBeenCalled();
    else {
      expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]?.[1]).toContain('Avatar updated');
      expect(f.send.mock.calls[0]?.[1]).toContain('New display');
      expect(f.send.mock.calls[0]?.[2]?.galleryUrls).toHaveLength(2);
    }
  });

  test.each([true, false])('server nickname/avatar changes are logged only for humans (bot=%s)', async (bot) => {
    const f = fixture();
    const before = f.member(bot, 'Before', 'a'.repeat(32));
    const after = f.member(bot, 'After', 'b'.repeat(32));
    await f.memberListener.run(before, before);
    f.send.mockClear();
    await f.memberListener.run(before, after);
    expect(f.invalidate).toHaveBeenCalledWith(f.guild.id);
    if (bot) expect(f.send).not.toHaveBeenCalled();
    else {
      expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]?.[1]).toContain('Server avatar updated');
      expect(f.send.mock.calls[0]?.[1]).toContain('After');
    }
  });

  test('a bot role change still logs when its nickname and server avatar also change', async () => {
    const f = fixture();
    const roleId = '300000000000000000';
    f.guild.roles.cache.set(roleId, new Role(f.client, { id: roleId, name: 'Bot role', permissions: '0' }, f.guild));
    const before = f.member(true, 'Before', 'a'.repeat(32));
    const after = f.member(true, 'After', 'b'.repeat(32), [roleId]);
    await f.memberListener.run(before, before);
    f.send.mockClear();
    await f.memberListener.run(before, after);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[1]).toContain(`<@&${roleId}>`);
    expect(f.send.mock.calls[0]?.[1]).not.toContain('avatar');
    expect(f.send.mock.calls[0]?.[1]).not.toContain('After');
    expect(f.send.mock.calls[0]?.[2]?.galleryUrls).toBeUndefined();
  });

  test('bot banner changes still log while bot name and avatar changes remain hidden', async () => {
    const f = fixture();
    guildMemberInCache(f, true);
    const before = new User(f.client, {
      id: f.userId,
      username: 'Before',
      avatar: 'a'.repeat(32),
      banner: null,
      bot: true
    });
    const after = new User(f.client, {
      id: f.userId,
      username: 'After',
      avatar: 'b'.repeat(32),
      banner: 'c'.repeat(32),
      bot: true
    });
    vi.spyOn(before, 'fetch').mockResolvedValue(before);
    vi.spyOn(after, 'fetch').mockResolvedValue(after);
    await f.userListener.run(before, before);
    await f.userListener.run(before, after);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[1]).toContain('Banner updated');
    expect(f.send.mock.calls[0]?.[1]).not.toContain('Avatar updated');
    expect(f.send.mock.calls[0]?.[1]).not.toContain('After');
  });
});

describe('profile name change accuracy', () => {
  test.each(['New nickname', null])(
    'nickname command records the before value when changing to %s',
    async (nickname) => {
      const f = fixture();
      await f.client.stores.get('arguments').loadAll();
      const actor = { id: '400000000000000000', username: 'Owner' };
      f.guild.ownerId = actor.id;
      f.guild.members.cache.set(actor.id, new GuildMember(f.client, { user: actor, roles: [] }, f.guild));
      const target = f.member(false, 'Original nickname', '');
      f.guild.members.cache.set(target.id, target);
      vi.spyOn(target, 'manageable', 'get').mockReturnValue(true);
      vi.spyOn(target, 'setNickname').mockImplementation(async (value) => {
        target.nickname = value;
        return target;
      });
      const channel = new TextChannel(f.guild, { id: '500000000000000000', name: 'test', type: 0 }, f.client);
      f.client.channels.cache.set(channel.id, channel);
      const input = `<@${target.id}>${nickname ? ` ${nickname}` : ''}`;
      const message = new Message(f.client, {
        id: '600000000000000000',
        guild_id: f.guild.id,
        channel_id: channel.id,
        author: actor,
        content: `!nick ${input}`,
        timestamp: new Date(0).toISOString(),
        type: 0,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: []
      });
      vi.spyOn(message, 'reply').mockResolvedValue(message);
      vi.spyOn(memberResolver, 'resolve').mockResolvedValue({ member: target, consumed: 1, confidence: 1 });
      const send = vi.spyOn(loggingService, 'sendAdministrativeLog').mockResolvedValue(undefined);
      const command = new NickCommand({
        name: 'nick',
        root: process.cwd(),
        path: 'commands/moderation/nick.ts',
        store: f.client.stores.get('commands')
      });
      const args = await command.messagePreParse(message, input, {
        commandName: 'nick',
        prefix: '!',
        commandPrefix: '!'
      });
      await command.messageRun(message, args);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[2]?.metadata).toEqual({
        'Previous Nickname': 'Original nickname',
        'New Nickname': nickname ?? 'Cleared'
      });
    }
  );

  test('uses the event before nickname after an intervening change was missed', async () => {
    const f = fixture();
    const cached = f.member(false, 'Cached', 'a'.repeat(32));
    await f.memberListener.run(cached, cached);
    const before = f.member(false, 'Actual before', 'a'.repeat(32));
    const after = f.member(false, 'Actual after', 'a'.repeat(32));
    await f.memberListener.run(before, after);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[1]).toContain('Nickname changed: `Actual before` → `Actual after`');
    expect(f.send.mock.calls[0]?.[1]).not.toContain('Cached');
  });

  test('does not invent a nickname change when only the fallback display name changes', async () => {
    const f = fixture();
    const before = f.member(false, null, 'a'.repeat(32));
    await f.memberListener.run(before, before);
    const after = f.member(false, null, 'a'.repeat(32));
    vi.spyOn(before, 'displayName', 'get').mockReturnValue('Old global name');
    vi.spyOn(after, 'displayName', 'get').mockReturnValue('New global name');
    await f.memberListener.run(before, after);
    expect(f.send).not.toHaveBeenCalled();
  });

  test('clearing a nickname shows the fallback and distinguishes a reset from a rename', async () => {
    const f = fixture();
    await f.memberListener.run(f.member(false, 'Server nick', ''), f.member(false, null, ''));
    expect(f.send.mock.calls[0]?.[1]).toContain('Nickname cleared: `Server nick` → `Account`');
  });

  test('does not claim a known previous nickname for a partial member', async () => {
    const f = fixture();
    const before = f.member(false, null, '');
    vi.spyOn(before, 'partial', 'get').mockReturnValue(true);
    await f.memberListener.run(before, f.member(false, 'Current nickname', ''));
    expect(f.send).not.toHaveBeenCalled();
  });

  test('suppresses duplicate events without losing rapid nickname reversals', async () => {
    const f = fixture();
    const a = f.member(false, 'Alpha', '');
    const b = f.member(false, 'Beta', '');
    await f.memberListener.run(a, b);
    await f.memberListener.run(a, b);
    await f.memberListener.run(b, a);
    await f.memberListener.run(a, b);
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  test('a failed banner request does not discard username or display-name resets', async () => {
    const f = fixture();
    guildMemberInCache(f, false);
    const before = new User(f.client, { id: f.userId, username: 'Before', global_name: 'Display' });
    const after = new User(f.client, { id: f.userId, username: 'After', global_name: null });
    vi.spyOn(after, 'fetch').mockRejectedValue(new Error('Unavailable'));
    await f.userListener.run(before, after);
    expect(f.send.mock.calls[0]?.[1]).toContain('Username: `Before` → `After`');
    expect(f.send.mock.calls[0]?.[1]).toContain('Display name cleared: `Display` → `After` (username)');
  });

  test('refreshes lookup indexes before REST can mutate the cached user', async () => {
    const f = fixture();
    guildMemberInCache(f, false);
    const before = new User(f.client, { id: f.userId, username: 'Before' });
    const after = new User(f.client, { id: f.userId, username: 'After' });
    vi.spyOn(after, 'fetch').mockImplementation(async () => {
      expect(f.invalidate).toHaveBeenCalledWith(f.guild.id);
      after.username = 'Before';
      return after;
    });
    await f.userListener.run(before, after);
    expect(f.send.mock.calls[0]?.[1]).toContain('Username: `Before` → `After`');
  });
});

function guildMemberInCache(f: ReturnType<typeof fixture>, bot: boolean): void {
  const member = f.member(bot, 'Initial', 'a'.repeat(32));
  f.guild.members.cache.set(member.id, member);
}
