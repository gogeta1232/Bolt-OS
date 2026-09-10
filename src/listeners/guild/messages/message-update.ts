import { Events, Listener } from '@sapphire/framework';
import { AttachmentBuilder, type Message, type PartialMessage } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';
import {
  fetchPartialMessage,
  formatContentPreview,
  embedsAreDifferent,
  formatEmbedChanges
} from '../../../lib/utils/message-helpers.js';

export class MessageUpdateListener extends Listener<typeof Events.MessageUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageUpdate });
  }

  public async run(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
    if (!newMessage.guild) return;

    // Fetch partials
    const oldFull = await fetchPartialMessage(oldMessage);
    const newFull = await fetchPartialMessage(newMessage);

    if (!oldFull || !newFull) return;

    // Check what changed
    const contentChanged = oldFull.content !== newFull.content;
    const embedsChanged = embedsAreDifferent(oldFull.embeds, newFull.embeds);
    const attachmentsChanged = oldFull.attachments.size !== newFull.attachments.size;
    const stickersChanged = oldFull.stickers.size !== newFull.stickers.size;

    if (!contentChanged && !embedsChanged && !attachmentsChanged && !stickersChanged) return;

    // Store edited message in snipe service
    if (!newFull.author.bot && contentChanged) {
      this.container.snipe.storeEditedMessage(oldFull, newFull);
    }

    // Build log description
    const lines = [
      `### ${getEmoji('message')} Message Edited`,
      `> **Author:** ${newFull.author} (\`${newFull.author.tag}\`)`,
      `> **Channel:** <#${newFull.channel.id}>`,
      `> **[Jump to Message](${newFull.url})**`,
      `> **Edited:** <t:${Math.floor((newFull.editedTimestamp ?? Date.now()) / 1000)}:R>`
    ];

    // Show content changes
    if (contentChanged) {
      lines.push(
        ``,
        `**Before:**`,
        formatContentPreview(oldFull.content, 500),
        ``,
        `**After:**`,
        formatContentPreview(newFull.content, 500)
      );
    }
    // Show embed changes
    if (embedsChanged) {
      lines.push(``, `**Embed Changes:**`);
      lines.push(...formatEmbedChanges(oldFull.embeds, newFull.embeds));
    }

    // Show attachment changes
    if (attachmentsChanged) {
      lines.push(``, `**Attachments:**`, `> ${oldFull.attachments.size} → ${newFull.attachments.size}`);
    }

    // Show sticker changes
    if (stickersChanged) {
      lines.push(``, `**Stickers:**`, `> ${oldFull.stickers.size} → ${newFull.stickers.size}`);
    }

    if (newFull.guild) {
      // Long edit? Keep full before/after as an in-card transcript file.
      const files = [];
      if (contentChanged) {
        const transcript = `BEFORE:\n${oldFull.content}\n\nAFTER:\n${newFull.content}`;
        if (transcript.length > 2000) {
          files.push(new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `edited-${newFull.id}.txt` }));
        }
      }
      await this.container.logging.sendMessageEditLog(newFull.guild, lines.join('\n'), {
        target: newFull.author,
        timestamp: Date.now(),
        showTitle: false,
        showTimestamp: false,
        showTargetAvatar: true,
        hideDetailsSection: true,
        files: files.length > 0 ? files : undefined
      });
    }
  }
}
