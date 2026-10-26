import { Client, Collection, Guild, GuildMember } from 'discord.js';
import { describe, expect, test, vi } from 'vitest';

import { fetchGuildMemberStats } from '../../src/lib/guild-member-stats.js';

describe('guild member statistics', () => {
  test('shares a full member fetch across overlapping statistics commands', async () => {
    const members = new Collection<string, GuildMember>();
    let complete: (value: Collection<string, GuildMember>) => void = () => undefined;
    const pending = new Promise<Collection<string, GuildMember>>((resolve) => {
      complete = resolve;
    });
    const fetch = vi.fn(() => pending);
    const guild = { memberCount: 1, members: { cache: members, fetch } } as unknown as Guild;
    const requests = Array.from({ length: 20 }, () => fetchGuildMemberStats(guild));
    complete(members);
    await Promise.all(requests);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('counts current cached members without fetching and sees subsequent changes', async () => {
    const client = new Client({ intents: [] });
    const guild = new Guild(client, { id: '123456789012345678', name: 'Test', member_count: 1 });
    const member = new GuildMember(
      client,
      { user: { id: '123456789012345679', username: 'human', bot: false }, roles: [] },
      guild
    );
    guild.members.cache.set(member.id, member);
    const fetch = vi.spyOn(guild.members, 'fetch');
    expect(await fetchGuildMemberStats(guild)).toEqual({ total: 1, humans: 1, bots: 0 });
    member.user.bot = true;
    expect(await fetchGuildMemberStats(guild)).toEqual({ total: 1, humans: 0, bots: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('clears failed pending requests so the next command can recover', async () => {
    const client = new Client({ intents: [] });
    const guild = new Guild(client, { id: '123456789012345678', name: 'Test', member_count: 1 });
    const fetch = vi.spyOn(guild.members, 'fetch').mockRejectedValueOnce(new Error('gateway unavailable'));
    await expect(fetchGuildMemberStats(guild)).rejects.toThrow('gateway unavailable');
    fetch.mockResolvedValueOnce(new Collection());
    expect(await fetchGuildMemberStats(guild)).toEqual({ total: 1, humans: 0, bots: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
