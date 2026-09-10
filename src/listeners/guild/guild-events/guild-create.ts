import { Events, Listener } from '@sapphire/framework';
import type { Guild } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class GuildCreateListener extends Listener<typeof Events.GuildCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildCreate });
  }

  public async run(guild: Guild) {
    this.container.memberResolver.invalidateGuild(guild.id);
    await this.container.logging.sendAuditLog(guild, `${getEmoji('audit')} **Joined guild**`, {
      metadata: {
        Name: guild.name,
        'Guild ID': guild.id,
        Owner: guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown',
        Members: guild.memberCount ?? 'Unknown'
      },
      timestamp: Date.now()
    });
    this.container.logger.info({ guildId: guild.id }, 'Joined guild');
  }
}

export class GuildDeleteListener extends Listener<typeof Events.GuildDelete> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildDelete });
  }

  public async run(guild: Guild) {
    this.container.memberResolver.invalidateGuild(guild.id);
    this.container.logger.warn({ guildId: guild.id }, 'Removed from guild');
  }
}
