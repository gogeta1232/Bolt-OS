import { Collection, type Guild, type GuildMember, type Message } from 'discord.js';
import { describe, expect, test, vi } from 'vitest';

import { MemberResolver } from '../../src/services/core/member-resolver.js';

const createMember = (id: string, nickname: string | null, username: string): GuildMember =>
  ({
    id,
    nickname,
    displayName: nickname ?? username,
    user: {
      username,
      globalName: null,
      discriminator: '0',
      tag: username
    }
  }) as GuildMember;

const createGuild = (
  id: string,
  cachedMembers: readonly GuildMember[],
  remoteMembers: readonly GuildMember[] = []
): { guild: Guild; search: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> } => {
  const cache = new Collection<string, GuildMember>(cachedMembers.map((member) => [member.id, member]));
  const search = vi.fn(async ({ query }: { query: string }) => {
    const normalized = query.toLowerCase();
    return new Collection<string, GuildMember>(
      remoteMembers
        .filter((member) =>
          [member.displayName, member.nickname, member.user.username].some((name) =>
            name?.toLowerCase().startsWith(normalized)
          )
        )
        .map((member) => [member.id, member])
    );
  });
  const fetch = vi.fn(async (memberId: string) => cache.get(memberId) ?? null);
  const guild = { id, members: { cache, search, fetch } } as unknown as Guild;
  return { guild, search, fetch };
};

const createMessage = (guild: Guild): Message => ({ guild }) as Message;

describe('MemberResolver', () => {
  test('resolves a multi-word nickname from the guild index without Discord requests', async () => {
    const target = createMember('member-1', 'Thunder Wolf', 'hidden_username');
    const { guild, search, fetch } = createGuild('guild-1', [target]);

    const result = await new MemberResolver().resolve(createMessage(guild), ['Thunder', 'Wolf', 'spamming']);

    expect(result.member).toBe(target);
    expect(result.consumed).toBe(2);
    expect(result.confidence).toBe(0);
    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('keeps nickname indexes isolated between guilds with identical member IDs', async () => {
    const memberInFirstGuild = createMember('same-user', 'Alpha', 'shared_username');
    const memberInSecondGuild = createMember('same-user', 'Beta', 'shared_username');
    const first = createGuild('guild-alpha', [memberInFirstGuild]);
    const second = createGuild('guild-beta', [memberInSecondGuild]);
    const resolver = new MemberResolver();

    await resolver.resolve(createMessage(first.guild), ['Alpha']);
    const result = await resolver.resolve(createMessage(second.guild), ['Beta']);

    expect(result.member).toBe(memberInSecondGuild);
    expect(second.search).not.toHaveBeenCalled();
  });

  test('searches Discord for an uncached nickname and preserves following reason tokens', async () => {
    const cached = createMember('bot', null, 'Bolt');
    const target = createMember('member-remote', 'Night Hawk', 'private_username');
    const { guild, search } = createGuild('guild-large', [cached], [target]);

    const result = await new MemberResolver().resolve(createMessage(guild), ['Night', 'Hawk', 'spamming']);

    expect(result.member).toBe(target);
    expect(result.consumed).toBe(2);
    expect(search).toHaveBeenCalled();
  });

  test('does not use an unrelated message mention as the target', async () => {
    const mentioned = createMember('12345678901234567', 'Mentioned', 'mentioned_user');
    const intended = createMember('member-2', 'Intended', 'intended_user');
    const { guild } = createGuild('guild-mentions', [mentioned, intended]);
    const message = {
      guild,
      mentions: { members: new Collection([[mentioned.id, mentioned]]) }
    } as unknown as Message;

    const result = await new MemberResolver().resolve(message, ['Intended']);

    expect(result.member).toBe(intended);
  });

  test('normalizes nickname case and accents', async () => {
    const target = createMember('member-accented', 'ÉCLAIR', 'pastry_user');
    const { guild, search } = createGuild('guild-accents', [target]);

    const result = await new MemberResolver().resolve(createMessage(guild), ['eclair']);

    expect(result.member).toBe(target);
    expect(search).not.toHaveBeenCalled();
  });

  test('reports duplicate nicknames as ambiguous instead of choosing silently', async () => {
    const first = createMember('duplicate-1', 'Shadow', 'first_user');
    const second = createMember('duplicate-2', 'Shadow', 'second_user');
    const { guild } = createGuild('guild-duplicates', [first, second]);

    const result = await new MemberResolver().resolve(createMessage(guild), ['Shadow']);

    expect(result.member).toBeNull();
    expect(result.reason).toBe('ambiguous');
    expect(result.feedback).toContain('first_user');
    expect(result.feedback).toContain('second_user');
  });
});
