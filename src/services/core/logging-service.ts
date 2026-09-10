import { container } from '@sapphire/framework';
import { PermissionsBitField, type Guild, type GuildTextBasedChannel } from 'discord.js';

import { buildLogV2Container, type LogContext, type LogType } from '../../config/logging.js';
import type { GuildConfigDocument } from '../../database/models/guild/GuildConfig.js';

const LOG_CHANNEL_CACHE_TTL_MS = 10 * 60_000;

class LoggingService {
  private readonly channelCache = new Map<string, { channel: GuildTextBasedChannel; expiresAt: number }>();
  public async sendLog(guild: Guild, type: LogType, description: string, context?: LogContext) {
    await this.dispatch(guild, this.resolveChannelKey(type), type, description, context);
  }

  public async sendAuditLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'audit', description, context);
  }

  public async sendModerationLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'moderation', description, context);
  }

  public async sendAdministrativeLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'administrative', description, context);
  }

  public async sendMessageDeleteLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'messageDelete', description, context);
  }

  public async sendMessageEditLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'messageEdit', description, context);
  }

  public async sendReactionLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'reaction', description, context);
  }

  public async sendEmojiLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'emoji', description, context);
  }

  public async sendChannelLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'channel', description, context);
  }

  public async sendChannelCreateLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'channelCreate', description, context);
  }

  public async sendChannelDeleteLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'channelDelete', description, context);
  }

  public async sendChannelUpdateLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'channelUpdate', description, context);
  }

  public async sendMemberJoinLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'memberJoin', description, context);
  }

  public async sendMemberLeaveLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'memberLeave', description, context);
  }

  public async sendMemberUpdateLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'memberUpdate', description, context);
  }

  public async sendCaseLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'cases', description, context);
  }

  public async sendRoleLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'role', description, context);
  }

  public async sendGuildLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'guild', description, context);
  }

  public async sendVoiceLog(guild: Guild, description: string, context?: LogContext) {
    await this.sendLog(guild, 'voice', description, context);
  }

  private async resolveLogChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel | null> {
    const cacheKey = `${guild.id}:${channelId}`;
    const cached = this.channelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.channel;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return null;

    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) return null;

    const textChannel = channel as GuildTextBasedChannel;
    this.channelCache.set(cacheKey, { channel: textChannel, expiresAt: Date.now() + LOG_CHANNEL_CACHE_TTL_MS });
    if (this.channelCache.size > 500) {
      const firstKey = this.channelCache.keys().next().value;
      if (firstKey) this.channelCache.delete(firstKey);
    }
    return textChannel;
  }

  private async dispatch(
    guild: Guild,
    channelKey: keyof GuildConfigDocument['logChannels'],
    type: LogType,
    description: string,
    context?: LogContext
  ) {
    try {
      const config = await container.config.fetch(guild.id);
      const channelId = config.logChannels?.[channelKey];
      if (!channelId) return;
      const channel = await this.resolveLogChannel(guild, channelId);
      if (!channel) return;
      // Sleek V2: single Container per log — header pills, content, inline details, muted footer.
      const { components, flags, files } = buildLogV2Container(type, description, context);
      await channel.send({
        components,
        flags,
        ...(files && files.length > 0 ? { files } : {}),
        // WHY camelCase: discord.js MessagePayload only reads options.allowedMentions —
        // snake_case is silently dropped and pings fire (verified against resolveBody).
        allowedMentions: { parse: [], users: [], roles: [], replied_user: false }
      } as never);
    } catch (error) {
      container.logger.fatal(
        {
          err: error,
          guildId: guild.id,
          channelKey,
          description,
          context
        },
        'Failed to dispatch log'
      );
    }
  }

  private resolveChannelKey(type: LogType): keyof GuildConfigDocument['logChannels'] {
    switch (type) {
      case 'audit':
        return 'audit';
      case 'moderation':
        return 'moderation';
      case 'administrative':
        return 'administrative';
      case 'messageDelete':
      case 'messageEdit':
        return 'message';
      case 'reaction':
        return 'reaction';
      case 'memberJoin':
      case 'memberLeave':
      case 'memberUpdate':
        return 'member';
      case 'channel':
      case 'channelCreate':
      case 'channelDelete':
      case 'channelUpdate':
        return 'channel';
      case 'emoji':
        return 'emoji';
      case 'cases':
        return 'cases';
      case 'role':
        return 'audit';
      case 'guild':
        return 'audit';
      case 'voice':
        return 'voice';
      default:
        return 'audit';
    }
  }
}

export const loggingService = new LoggingService();
