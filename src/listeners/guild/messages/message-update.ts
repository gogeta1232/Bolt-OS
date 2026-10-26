import { Events, Listener } from '@sapphire/framework';
import { AttachmentBuilder, type Message, type PartialMessage } from 'discord.js';

import { isOwnMessage, messageLogChanges } from '../../../lib/message-log.js';
import {
  fetchPartialMessage,
  formatMessageEditSnapshot,
  formatEmbedChanges,
  formatEmbedEditTranscript
} from '../../../lib/utils/message-helpers.js';

const EDIT_PREVIEW_MAX = 1200;
const quoteBody = (body: string): string =>
  body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
const previewBody = (body: string): string => {
  const quoted = quoteBody(body);
  return quoted.length > EDIT_PREVIEW_MAX ? `${quoted.slice(0, EDIT_PREVIEW_MAX - 1)}…` : quoted;
};

export class MessageUpdateListener extends Listener<typeof Events.MessageUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageUpdate });
  }

  public async run(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
    if (!newMessage.guild || isOwnMessage(newMessage, this.container.client.user?.id)) return;

    // Fetching an old partial returns the current message, not its previous body.
    if (oldMessage.partial) return;
    const oldFull = oldMessage;
    const newFull = await fetchPartialMessage(newMessage);

    if (!newFull || isOwnMessage(newFull, this.container.client.user?.id)) return;

    // Check what changed
    const changes = messageLogChanges(oldFull, newFull);
    const {
      content: contentChanged,
      embeds: embedsChanged,
      attachments: attachmentsChanged,
      stickers: stickersChanged,
      components: componentsChanged
    } = changes;

    if (!contentChanged && !embedsChanged && !attachmentsChanged && !stickersChanged && !componentsChanged) return;
    // Discord can generate link previews without the member editing their message.
    if (
      !newFull.author.bot &&
      !contentChanged &&
      !attachmentsChanged &&
      !stickersChanged &&
      !componentsChanged &&
      oldFull.editedTimestamp === newFull.editedTimestamp
    )
      return;

    // Store edited message in snipe service
    if (!newFull.author.bot && contentChanged) {
      this.container.snipe.storeEditedMessage(oldFull, newFull);
    }

    // The shared formatter owns author, channel, time and message link.
    const lines: string[] = [];

    const showSnapshots = contentChanged || componentsChanged || attachmentsChanged || stickersChanged;
    const beforeBody = formatMessageEditSnapshot(oldFull);
    const afterBody = formatMessageEditSnapshot(newFull);
    // Include the actual embed/component body when a bot replaces its loading text.
    if (showSnapshots && beforeBody !== afterBody) {
      lines.push(``, `**Before:**`, previewBody(beforeBody), ``, `**After:**`, previewBody(afterBody));
    } else if (componentsChanged) {
      lines.push('Controls or media settings updated.');
    }
    // Show embed changes
    if (embedsChanged && !showSnapshots) {
      lines.push(``);
      lines.push(...formatEmbedChanges(oldFull.embeds, newFull.embeds));
    }
    if (lines.length === 0) return;

    if (newFull.guild) {
      // Long edit? Keep full before/after as an in-card transcript file.
      const files = [];
      if (showSnapshots) {
        const transcript = `BEFORE:\n${beforeBody}\n\nAFTER:\n${afterBody}`;
        if (quoteBody(beforeBody).length > EDIT_PREVIEW_MAX || quoteBody(afterBody).length > EDIT_PREVIEW_MAX) {
          files.push(new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `edited-${newFull.id}.txt` }));
        }
      }
      if (embedsChanged && !showSnapshots) {
        const transcript = formatEmbedEditTranscript(oldFull.embeds, newFull.embeds);
        if (transcript) {
          files.push(new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `embeds-${newFull.id}.txt` }));
        }
      }
      await this.container.logging.sendMessageEditLog(newFull.guild, lines.join('\n'), {
        target: newFull.author,
        channel: { id: newFull.channelId },
        message: { id: newFull.id, url: newFull.url, revision: changes.revision },
        timestamp: newFull.editedTimestamp ?? Date.now(),
        showTitle: false,
        showTimestamp: false,
        showTargetAvatar: true,
        hideDetailsSection: true,
        files: files.length > 0 ? files : undefined
      });
    }
  }
}
