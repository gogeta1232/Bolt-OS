import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

export class GuildMemberRemoveListener extends Listener<typeof Events.GuildMemberRemove> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberRemove });
  }

  public async run(member: GuildMember) {
    this.container.memberResolver.invalidateGuild(member.guild.id);
    // V2 header carries user pill + avatar + leave time; inline carries join time.
    await this.container.logging.sendMemberLeaveLog(member.guild, '', {
      target: member.user,
      showTargetAvatar: true,
      timestamp: Date.now(),
      metadata: {
        'Joined Server': member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'
      }
    });
  }
}
