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

export const fetchGuildMemberStats = async (guild: Guild): Promise<GuildMemberStats> => {
  if (guild.members.cache.size >= guild.memberCount) {
    return countMembers(guild.members.cache, guild.memberCount);
  }

  const members = await guild.members.fetch({ withPresences: false });
  return countMembers(members, guild.memberCount);
};
