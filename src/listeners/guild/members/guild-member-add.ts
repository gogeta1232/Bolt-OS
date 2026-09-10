import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

import { createEmbed } from '../../../config/theme.js';

export class GuildMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberAdd });
  }

  public async run(member: GuildMember) {
    this.container.memberResolver.invalidateGuild(member.guild.id);
    const config = await this.container.config.fetch(member.guild.id);

    if (config.welcome?.channelId) {
      const channel = await member.guild.channels.fetch(config.welcome.channelId);
      if (channel?.isTextBased()) {
        const description =
          config.welcome.message?.replaceAll('{user}', member.toString())?.replaceAll('{guild}', member.guild.name) ??
          `Welcome ${member.toString()}!`;
        await channel.send({
          embeds: [createEmbed({ description, type: 'success' })],
          allowedMentions: { parse: [], users: [member.id] }
        });
      }
    }

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
