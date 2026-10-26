import type { Collection, Guild, GuildMember } from 'discord.js';

export interface GuildMemberStats {
  total: number;
  humans: number;
  bots: number;
}

const countMembers = (members: Collection<string, GuildMember>, total: number): GuildMemberStats => {
  let bots = 0;
  for (const member of members.values()) {
    if (member.user.bot) bots += 1;
  }
  return { total, humans: members.size - bots, bots };
};

// Only overlapping requests are shared. Completed results are counted from the
// current gateway cache, so joins, leaves and bot changes remain visible.
const inFlight = new WeakMap<Guild, Promise<GuildMemberStats>>();

export const fetchGuildMemberStats = async (guild: Guild): Promise<GuildMemberStats> => {
  const pending = inFlight.get(guild);
  if (pending) return pending;

  if (guild.members.cache.size >= guild.memberCount) {
    return countMembers(guild.members.cache, guild.memberCount);
  }

  const request = guild.members
    .fetch({ withPresences: false })
    .then((members) => countMembers(members, guild.memberCount))
    .finally(() => inFlight.delete(guild));
  inFlight.set(guild, request);
  return request;
};
