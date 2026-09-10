import { Events, Listener } from '@sapphire/framework';
import type { NonThreadGuildBasedChannel } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class ChannelUpdateListener extends Listener<typeof Events.ChannelUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.ChannelUpdate });
  }

  public async run(oldChannel: NonThreadGuildBasedChannel, newChannel: NonThreadGuildBasedChannel) {
    if (!newChannel.guild) {
      this.container.logger.debug({ channelId: newChannel.id }, 'Channel update: Channel not in guild, returning');
      return;
    }

    const changes: string[] = [];

    // Check for name changes
    if ('name' in oldChannel && 'name' in newChannel && oldChannel.name !== newChannel.name) {
      changes.push(`> • **Name:** ${oldChannel.name} → ${newChannel.name}`);
    }

    // Check for NSFW changes
    if ('nsfw' in oldChannel && 'nsfw' in newChannel && oldChannel.nsfw !== newChannel.nsfw) {
      changes.push(`> • **NSFW:** ${oldChannel.nsfw ? 'Yes' : 'No'} → ${newChannel.nsfw ? 'Yes' : 'No'}`);
    }

    // Check for rate limit changes
    if (
      'rateLimitPerUser' in oldChannel &&
      'rateLimitPerUser' in newChannel &&
      oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser
    ) {
      changes.push(`> • **Slowmode:** ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
    }

    // Check for category changes
    if ('parentId' in oldChannel && 'parentId' in newChannel && oldChannel.parentId !== newChannel.parentId) {
      const oldParent = oldChannel.parentId ? `<#${oldChannel.parentId}>` : 'No category';
      const newParent = newChannel.parentId ? `<#${newChannel.parentId}>` : 'No category';
      changes.push(`> • **Category:** ${oldParent} → ${newParent}`);
    }

    // If no changes detected, don't send a log
    if (changes.length === 0) return;

    const identifier =
      'name' in newChannel && typeof newChannel.name === 'string'
        ? `#${newChannel.name}`
        : (newChannel as { id: string }).id;

    // Try to fetch the user who updated the channel from audit logs
    let actor = null;
    try {
      // Add a delay to ensure audit log entry is created (Discord may take time to generate audit logs for channel operations)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Add error handling and more robust audit log fetching for channel update
      const fetchedLogs = await newChannel.guild.fetchAuditLogs({
        limit: 5,
        type: 11
      }); // Channel update = 11
      for (const [, auditLog] of fetchedLogs.entries) {
        // For channel update, the target is the channel object itself
        if (auditLog.target?.id === newChannel.id) {
          actor = auditLog.executor
            ? await newChannel.guild.client.users.fetch(auditLog.executor.id).catch(() => null)
            : null;
          break;
        }
      }
    } catch (error) {
      // If we can't fetch audit logs, continue without the actor
      this.container.logger.debug(
        {
          err: error,
          channelId: newChannel.id,
          guildId: newChannel.guild.id
        },
        'Error fetching audit logs for channel update'
      );
    }

    const channelType =
      newChannel.type === 0
        ? 'Text'
        : newChannel.type === 2
          ? 'Voice'
          : newChannel.type === 4
            ? 'Category'
            : newChannel.type === 5
              ? 'Announcement'
              : newChannel.type === 13
                ? 'Stage'
                : newChannel.type === 15
                  ? 'Forum'
                  : 'Unknown';

    const description = [
      `### ${getEmoji('channel')} Channel Updated`,
      `> **Channel:** <#${newChannel.id}>`,
      `> **Type:** ${channelType}`,
      `> **Updated By:** <@${actor?.id || 'unknown'}>${actor?.bot ? ' (Bot)' : ''}`,
      `> **ID:** \`${newChannel.id}\``,
      ``,
      `**Changes:**`,
      ...changes
    ].join('\n');

    this.container.logger.debug(
      {
        guildId: newChannel.guild.id,
        channelId: newChannel.id,
        identifier: identifier,
        actorId: actor?.id || 'unknown',
        description: description
      },
      'Prepared channel update log description'
    );

    // Check if channel logging is configured before attempting to send
    try {
      // Attempt to fetch guild config to see if channel logging is configured
      const config = await this.container.config.fetch(newChannel.guild.id);
      if (!config.logChannels?.channel) {
        this.container.logger.debug(
          {
            guildId: newChannel.guild.id,
            hasChannelLog: !!config.logChannels?.channel
          },
          'Channel logging not configured for guild'
        );
        return; // Don't try to send to non-existent log channel
      }

      this.container.logger.debug(
        {
          guildId: newChannel.guild.id,
          logChannelId: config.logChannels.channel
        },
        'Channel logging configured for guild'
      );
    } catch (error) {
      // If config fetch fails (database down), return
      this.container.logger.error(
        { err: error, guildId: newChannel.guild.id },
        'Failed to fetch guild config for channel update log'
      );
      return;
    }

    this.container.logger.debug(
      {
        guildId: newChannel.guild.id,
        channelId: newChannel.id,
        description: description,
        actorExists: !!actor
      },
      'About to send channel update log'
    );

    // Send the channel log, handling any errors gracefully
    try {
      await this.container.logging.sendChannelUpdateLog(newChannel.guild, description, {
        actor: actor,
        showActorAvatar: true,
        showTitle: false,
        timestamp: Date.now()
      });

      this.container.logger.debug(
        {
          guildId: newChannel.guild.id,
          channelId: newChannel.id
        },
        'Successfully sent channel update log'
      );
    } catch (error) {
      // Log the error but don't break the execution
      this.container.logger.error(
        { err: error, guildId: newChannel.guild.id, channelId: newChannel.id },
        'Failed to send channel update log'
      );
    }
  }
}
