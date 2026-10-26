import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

export class GuildMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberAdd });
  }

  public async run(member: GuildMember) {
    this.container.memberResolver.invalidateGuild(member.guild.id);

    // V2 header carries user pill + avatar + join time; inline carries account age.
    // No body text — keeps the card to ~4 rows with zero duplication.
    await this.container.logging.sendMemberJoinLog(member.guild, '', {
      target: member.user,
      showTargetAvatar: true,
      timestamp: member.joinedTimestamp ?? Date.now(),
      metadata: {
        'Account Created': `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`
      }
    });
  }
}
