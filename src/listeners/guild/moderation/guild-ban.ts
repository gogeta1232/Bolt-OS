import { Events, Listener } from '@sapphire/framework';
import type { GuildBan } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class GuildBanAddListener extends Listener<typeof Events.GuildBanAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildBanAdd });
  }

  public async run(ban: GuildBan) {
    await this.container.logging.sendModerationLog(ban.guild, `${getEmoji('ban')} **Member banned**`, {
      target: ban.user,
      timestamp: Date.now(),
      reason: ban.reason ?? null
    });
  }
}

export class GuildBanRemoveListener extends Listener<typeof Events.GuildBanRemove> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildBanRemove });
  }

  public async run(ban: GuildBan) {
    await this.container.logging.sendModerationLog(ban.guild, `${getEmoji('success')} **Member unbanned**`, {
      target: ban.user,
      timestamp: Date.now(),
      reason: ban.reason ?? null
    });
  }
}
