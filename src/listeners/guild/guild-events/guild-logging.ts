import { Events, Listener } from '@sapphire/framework';
import type { Guild } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class GuildUpdateListener extends Listener<typeof Events.GuildUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildUpdate });
  }

  public async run(oldGuild: Guild, newGuild: Guild) {
    const changes: string[] = [];

    if (oldGuild.name !== newGuild.name) {
      changes.push(`> • Name: **${oldGuild.name}** → **${newGuild.name}**`);
    }

    if (oldGuild.icon !== newGuild.icon) {
      const oldIcon = oldGuild.iconURL({ size: 256 }) || 'None';
      const newIcon = newGuild.iconURL({ size: 256 }) || 'None';
      changes.push(
        `> • Icon: ${oldIcon === 'None' ? oldIcon : `[Old](${oldIcon})`} → ${newIcon === 'None' ? newIcon : `[New](${newIcon})`}`
      );
    }

    if (oldGuild.banner !== newGuild.banner) {
      changes.push('> • Banner updated');
    }

    if (oldGuild.splash !== newGuild.splash) {
      changes.push('> • Splash updated');
    }

    if (oldGuild.description !== newGuild.description) {
      const oldDesc = oldGuild.description || 'None';
      const newDesc = newGuild.description || 'None';
      changes.push(`> • Description: ${oldDesc} → ${newDesc}`);
    }

    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
      const oldVanity = oldGuild.vanityURLCode || 'None';
      const newVanity = newGuild.vanityURLCode || 'None';
      changes.push(`> • Vanity URL: ${oldVanity} → ${newVanity}`);
    }

    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
      const oldChannel = oldGuild.afkChannelId ? `<#${oldGuild.afkChannelId}>` : 'None';
      const newChannel = newGuild.afkChannelId ? `<#${newGuild.afkChannelId}>` : 'None';
      changes.push(`> • AFK Channel: ${oldChannel} → ${newChannel}`);
    }

    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
      changes.push(`> • AFK Timeout: ${oldGuild.afkTimeout / 60}min → ${newGuild.afkTimeout / 60}min`);
    }

    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
      const oldChannel = oldGuild.systemChannelId ? `<#${oldGuild.systemChannelId}>` : 'None';
      const newChannel = newGuild.systemChannelId ? `<#${newGuild.systemChannelId}>` : 'None';
      changes.push(`> • System Channel: ${oldChannel} → ${newChannel}`);
    }

    if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
      const oldChannel = oldGuild.rulesChannelId ? `<#${oldGuild.rulesChannelId}>` : 'None';
      const newChannel = newGuild.rulesChannelId ? `<#${newGuild.rulesChannelId}>` : 'None';
      changes.push(`> • Rules Channel: ${oldChannel} → ${newChannel}`);
    }

    if (oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) {
      const oldChannel = oldGuild.publicUpdatesChannelId ? `<#${oldGuild.publicUpdatesChannelId}>` : 'None';
      const newChannel = newGuild.publicUpdatesChannelId ? `<#${newGuild.publicUpdatesChannelId}>` : 'None';
      changes.push(`> • Public Updates Channel: ${oldChannel} → ${newChannel}`);
    }

    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
      changes.push(`> • Verification Level: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
    }

    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
      changes.push(
        `> • Explicit Content Filter: ${oldGuild.explicitContentFilter} → ${newGuild.explicitContentFilter}`
      );
    }

    if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
      changes.push(
        `> • 2FA Level: ${oldGuild.mfaLevel === 0 ? 'None' : 'Required'} → ${newGuild.mfaLevel === 0 ? 'None' : 'Required'}`
      );
    }

    if (changes.length === 0) return;

    await this.container.logging.sendGuildLog(newGuild, `${getEmoji('settings')} **Guild settings updated**`, {
      fields: [{ name: 'Changes', value: changes.join('\n') }],
      metadata: {
        'Guild Name': newGuild.name,
        'Guild ID': newGuild.id
      },
      timestamp: Date.now()
    });
  }
}
