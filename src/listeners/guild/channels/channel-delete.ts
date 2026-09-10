import { Events, Listener } from '@sapphire/framework';
import type { NonThreadGuildBasedChannel } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class ChannelDeleteListener extends Listener<typeof Events.ChannelDelete> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.ChannelDelete });
  }

  public async run(channel: NonThreadGuildBasedChannel) {
    if (!channel.guild) {
      this.container.logger.debug({ channelId: channel.id }, 'Channel delete: Channel not in guild, returning');
      return;
    }

    this.container.logger.debug(
      {
        event: 'channelDelete',
        channelId: channel.id,
        guildId: channel.guild.id
      },
      'Channel delete event triggered'
    );

    const identifier =
      'name' in channel && typeof channel.name === 'string' && channel.name
        ? `#${channel.name}`
        : `Channel ${channel.id}`;

    // Try to fetch the user who deleted the channel from audit logs
    let actor = null;
    try {
      // Try multiple times to fetch audit logs since they might not be immediately available
      actor = await this.fetchActorFromAuditLogs(channel.guild, channel.id, 12, 5); // Channel delete = 12, try 5 times
    } catch (error) {
      // If we can't fetch audit logs, continue without the actor
      this.container.logger.debug(
        {
          err: error,
          channelId: channel.id,
          guildId: channel.guild.id
        },
        'Error fetching audit logs for channel deletion'
      );
    }

    const channelType =
      channel.type === 0
        ? 'Text'
        : channel.type === 2
          ? 'Voice'
          : channel.type === 4
            ? 'Category'
            : channel.type === 5
              ? 'Announcement'
              : channel.type === 13
                ? 'Stage'
                : channel.type === 15
                  ? 'Forum'
                  : 'Unknown';

    const description = [
      `### ${getEmoji('deletion')} Channel Deleted`,
      `> **Name:** ${identifier}`,
      `> **Type:** ${channelType}`,
      `> **Deleted By:** <@${actor?.id || 'unknown'}>${actor?.bot ? ' (Bot)' : ''}`,
      `> **ID:** \`${channel.id}\``
    ].join('\n');

    this.container.logger.debug(
      {
        guildId: channel.guild.id,
        channelId: channel.id,
        identifier: identifier,
        actorId: actor?.id || 'unknown',
        description: description
      },
      'Prepared channel delete log description'
    );

    // Check if channel logging is configured before attempting to send
    try {
      // Attempt to fetch guild config to see if channel logging is configured
      const config = await this.container.config.fetch(channel.guild.id);

      if (!config.logChannels?.channel) {
        this.container.logger.debug(
          {
            guildId: channel.guild.id,
            hasChannelLog: !!config.logChannels?.channel
          },
          'Channel logging not configured for guild'
        );
        return; // Don't try to send to non-existent log channel
      }

      this.container.logger.debug(
        {
          guildId: channel.guild.id,
          logChannelId: config.logChannels.channel
        },
        'Channel logging configured for guild'
      );
    } catch (error) {
      // If config fetch fails (database down), return
      this.container.logger.error(
        { err: error, guildId: channel.guild.id },
        'Failed to fetch guild config for channel delete log'
      );
      return;
    }

    this.container.logger.debug(
      {
        guildId: channel.guild.id,
        channelId: channel.id,
        description: description,
        actorExists: !!actor
      },
      'About to send channel delete log'
    );

    // Send the channel log, handling any errors gracefully
    try {
      await this.container.logging.sendChannelDeleteLog(channel.guild, description, {
        actor: actor,
        showActorAvatar: true,
        showTitle: false,
        timestamp: Date.now()
      });

      this.container.logger.debug(
        {
          guildId: channel.guild.id,
          channelId: channel.id
        },
        'Successfully sent channel delete log'
      );
    } catch (error) {
      // Log the error but don't break the execution
      this.container.logger.error(
        { err: error, guildId: channel.guild.id, channelId: channel.id },
        'Failed to send channel delete log'
      );
    }
  }

  private async fetchActorFromAuditLogs(
    guild: import('discord.js').Guild,
    targetId: string,
    auditLogType: number,
    maxRetries: number = 5
  ) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 3000));

        const fetchedLogs = await guild.fetchAuditLogs({
          limit: 5,
          type: auditLogType
        });
        this.container.logger.debug(
          {
            attempt: i + 1,
            targetId,
            auditLogType,
            count: fetchedLogs.entries.size,
            entries: fetchedLogs.entries.map((e) => ({
              targetId: e.target?.id,
              executorId: e.executor?.id
            }))
          },
          'Fetched audit logs for channel action'
        );

        const auditLog = fetchedLogs.entries.find((log) => log.target?.id === targetId);

        if (auditLog?.executor) {
          this.container.logger.debug(
            {
              attempt: i + 1,
              targetId,
              actorId: auditLog.executor.id
            },
            'Found matching audit log entry'
          );
          return await guild.client.users.fetch(auditLog.executor.id).catch(() => null);
        }

        this.container.logger.debug(
          {
            attempt: i + 1,
            targetId: targetId,
            auditLogType: auditLogType
          },
          'No matching audit log found, will retry'
        );
      } catch (error) {
        this.container.logger.error(
          {
            err: error,
            attempt: i + 1,
            targetId: targetId,
            auditLogType: auditLogType
          },
          'Error fetching audit logs, will retry'
        );
      }
    }

    this.container.logger.warn(
      {
        targetId: targetId,
        auditLogType: auditLogType,
        maxRetries: maxRetries
      },
      'Failed to find actor in audit logs after all retries'
    );

    return null;
  }
}
