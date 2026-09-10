import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { Collection } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

const voiceSessions = new Collection<string, number>();

export class VoiceStateUpdateListener extends Listener<typeof Events.VoiceStateUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.VoiceStateUpdate });
  }

  public async run(oldState: VoiceState, newState: VoiceState) {
    const member = newState.member ?? oldState.member;
    if (!member) return;

    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;
    const sessionKey = `${member.id}-${guild.id}`;

    if (!oldChannel && newChannel) {
      // User joins a voice channel
      voiceSessions.set(sessionKey, Date.now());
      await this.container.logging.sendVoiceLog(
        guild,
        `${getEmoji('voiceJoin')} ${member} joined voice channel ${newChannel}`,
        {
          showTargetAvatar: true,
          emojiIconUrl: member.user.displayAvatarURL({ size: 256 })
        }
      );
    } else if (oldChannel && !newChannel) {
      // User leaves a voice channel
      const startTime = voiceSessions.get(sessionKey);
      const duration = startTime ? this.formatDuration(Date.now() - startTime) : 'Unknown';
      voiceSessions.delete(sessionKey);

      await this.container.logging.sendVoiceLog(
        guild,
        `${getEmoji('voiceLeave')} ${member} left voice channel ${oldChannel}`,
        {
          showTargetAvatar: true,
          emojiIconUrl: member.user.displayAvatarURL({ size: 256 }),
          metadata: { 'Session Duration': duration }
        }
      );
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 0) ms = -ms;
    const time = {
      d: Math.floor(ms / 86400000),
      h: Math.floor(ms / 3600000) % 24,
      m: Math.floor(ms / 60000) % 60,
      s: Math.floor(ms / 1000) % 60
    };
    return Object.entries(time)
      .filter((val) => val[1] !== 0)
      .map(([key, val]) => `${val}${key}`)
      .join(', ');
  }
}
