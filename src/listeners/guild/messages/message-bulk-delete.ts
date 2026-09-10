import { Listener } from '@sapphire/framework';
import { AttachmentBuilder, Collection, type Message } from 'discord.js';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

import { getEmoji } from '../../../config/emojis.js';

export class MessageBulkDeleteListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: 'messageDeleteBulk' });
  }

  public async run(messages: Collection<string, Message<boolean>>) {
    if (messages.size === 0) return;

    const firstMessage = messages.first();
    if (!firstMessage?.guild) return;

    const { guild, channel } = firstMessage;

    // Process async in background - don't block
    const channelName = 'name' in channel ? (channel.name ?? channel.id) : channel.id;
    void this.logBulkDeletion(guild.id, guild.name, channel.id, channelName, messages);
  }

  private async logBulkDeletion(
    guildId: string,
    guildName: string,
    channelId: string,
    channelName: string,
    messages: Collection<string, Message<boolean>>
  ) {
    try {
      // Create log content
      const logLines = [
        `Bulk Message Deletion Log`,
        `Guild: ${guildName} (${guildId})`,
        `Channel: #${channelName} (${channelId})`,
        `Time: ${new Date().toISOString()}`,
        `Messages: ${messages.size}`,
        `===================================`,
        ``
      ];

      const sorted = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      for (const msg of sorted) {
        const author = msg.author || { tag: 'Unknown', id: 'unknown', bot: false };
        const timestamp = new Date(msg.createdTimestamp).toISOString();

        logLines.push(`ID: ${msg.id} | ${author.tag}${author.bot ? ' [BOT]' : ''} | ${timestamp}`);

        if (msg.content) logLines.push(`Content: ${msg.content}`);
        if (msg.attachments.size > 0) logLines.push(`Attachments: ${msg.attachments.size}`);
        if (msg.embeds.length > 0) logLines.push(`Embeds: ${msg.embeds.length}`);
        if (msg.stickers.size > 0) logLines.push(`Stickers: ${msg.stickers.size}`);

        logLines.push(`---`);
      }

      // Write to file asynchronously
      const logsDir = path.join(process.cwd(), 'logs');
      await mkdir(logsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `bulk-delete-${guildId}-${channelId}-${timestamp}.txt`;
      const filepath = path.join(logsDir, filename);
      const fileBody = logLines.join('\n');

      await writeFile(filepath, fileBody, 'utf-8');

      // Send summary to log channel
      const guild = this.container.client.guilds.cache.get(guildId);
      if (!guild) return;

      await this.container.logging.sendMessageDeleteLog(
        guild,
        [
          `### ${getEmoji('deletion')} Bulk Messages Deleted`,
          `> **Channel:** <#${channelId}>`,
          `> **Count:** ${messages.size} messages`
        ].join('\n'),
        {
          target: null,
          channel: { id: channelId, name: channelName },
          timestamp: Date.now(),
          showTitle: false,
          showTimestamp: false,
          showTargetAvatar: false,
          hideDetailsSection: true,
          // WHY: the on-disk copy is useless in Discord — attach the transcript itself.
          files: [new AttachmentBuilder(Buffer.from(fileBody, 'utf-8'), { name: filename })]
        }
      );
    } catch (error) {
      this.container.logger.error({ err: error, guildId, channelId }, 'Failed to log bulk deletion');
    }
  }
}
