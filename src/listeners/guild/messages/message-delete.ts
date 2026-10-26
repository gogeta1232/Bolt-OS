import { Events, Listener } from '@sapphire/framework';
import { AttachmentBuilder, type GuildBasedChannel, type Message, type PartialMessage } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';
import { resolveChannelContext, resolveMessageContext } from '../../../config/logging.js';
import {
  formatAttachments,
  formatContentPreview,
  formatEmbedSummary,
  formatStickers,
  hasLogableContent,
  extractV2ComponentText,
  summarizeV2Interactives
} from '../../../lib/utils/message-helpers.js';
import { downloadDiscordImage } from '../../../lib/remote-media.js';
import { isImageAttachment } from '../../../lib/afk-views.js';
import { isOwnMessage } from '../../../lib/message-log.js';

const ATTACHMENT_PREVIEW_MAX = 1000;
const V2_TEXT_JOIN_MAX = 1800;
const LOG_MEDIA_MAX = 4;
const LOG_MEDIA_FETCH_TIMEOUT_MS = 8000;
const LOG_MEDIA_MAX_BYTES = 8_000_000;

/**
 * Download media to buffers for re-upload into the log's gallery.
 * WHY buffered with caps: URL-based attach lets one dead/slow link fail the
 * entire log send — failures here just skip that image.
 */
async function fetchLogMedia(sources: string[][], base: string): Promise<AttachmentBuilder[]> {
  const out: AttachmentBuilder[] = [];
  for (const urls of sources.slice(0, LOG_MEDIA_MAX)) {
    for (const url of new Set(urls)) {
      const downloaded = await downloadDiscordImage(url, {
        maxBytes: LOG_MEDIA_MAX_BYTES,
        timeoutMs: LOG_MEDIA_FETCH_TIMEOUT_MS
      });
      if (!downloaded) continue;
      out.push(new AttachmentBuilder(downloaded.data, { name: `${base}-${out.length}.${downloaded.extension}` }));
      break;
    }
  }
  return out;
}

export class MessageDeleteListener extends Listener<typeof Events.MessageDelete> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageDelete });
  }

  public async run(message: Message | PartialMessage): Promise<void> {
    if (!message.guild || isOwnMessage(message, this.container.client.user?.id)) return;

    // Deleted messages cannot be fetched back from Discord. Use only captured data.
    if (message.author && !message.author.bot && hasLogableContent(message)) {
      this.container.snipe.storeDeletedMessage(message);
    }

    const source = message;
    const author = source.author ?? message.author ?? null;

    // Body sections — header pills (user • channel • time) and footer (ID • Jump)
    // come from context, so only real content goes here.
    const sections: string[] = [];

    const content = 'content' in source ? source.content : message.content;
    if (content?.trim()) {
      sections.push(`**Content:**\n${formatContentPreview(content, ATTACHMENT_PREVIEW_MAX)}`);
    }

    const embeds = source.embeds ?? message.embeds ?? [];
    if (embeds.length > 0) sections.push(formatEmbedSummary([...embeds]).join('\n'));

    const rawComponents =
      'components' in source && Array.isArray(source.components) ? (source.components as readonly unknown[]) : [];
    const v2Texts = extractV2ComponentText(rawComponents);
    if (v2Texts.length > 0) {
      sections.push(`**Components:**\n${v2Texts.join('\n\n').slice(0, V2_TEXT_JOIN_MAX)}`);
    }
    const v2Labels = summarizeV2Interactives(rawComponents);
    if (v2Labels.length > 0) sections.push(`-# ${getEmoji('radio')} ${v2Labels.join(' · ')}`);

    const attachments = 'attachments' in source ? source.attachments : message.attachments;
    if (attachments && attachments.size > 0) {
      const counts = formatAttachments([...attachments.values()]);
      if (counts.length > 0) sections.push(counts.join('\n'));
    }

    const stickers = 'stickers' in source ? source.stickers : message.stickers;
    if (stickers && stickers.size > 0) {
      sections.push(...formatStickers([...stickers.values()]));
    }

    // An uncached deletion may contain only an ID. Do not send an empty evidence card.
    if (sections.length === 0) return;

    // Re-upload every image (attachments + embed media + stickers) so the log
    // shows them in-card instead of bare links.
    const mediaUrls: string[][] = [];
    if (attachments && attachments.size > 0) {
      for (const att of attachments.values()) {
        if (isImageAttachment(att)) mediaUrls.push([att.url, att.proxyURL]);
      }
    }
    for (const embed of embeds) {
      if (embed.image?.url) mediaUrls.push([embed.image.url, ...(embed.image.proxyURL ? [embed.image.proxyURL] : [])]);
      if (embed.thumbnail?.url)
        mediaUrls.push([embed.thumbnail.url, ...(embed.thumbnail.proxyURL ? [embed.thumbnail.proxyURL] : [])]);
    }
    if (stickers && stickers.size > 0) {
      for (const sticker of stickers.values()) {
        if (sticker.url) mediaUrls.push([sticker.url]);
      }
    }
    const imageFiles = await fetchLogMedia(mediaUrls, `deleted-${message.id}`);

    // Over the readable limit? Show a slice, attach the whole thing as txt.
    // WHY: a single TextDisplay caps at 4000 chars — truncating alone would
    // silently lose evidence, so long deletes always keep a full transcript.
    const fullBody = sections.join('\n\n');
    let visibleBody = fullBody;
    const files = [...imageFiles];
    if (fullBody.length > 2000) {
      visibleBody = `${fullBody.slice(0, 1500)}…`;
      files.push(new AttachmentBuilder(Buffer.from(fullBody, 'utf-8'), { name: `deleted-${message.id}.txt` }));
    }

    await this.container.logging.sendMessageDeleteLog(message.guild, visibleBody, {
      target: author,
      channel: resolveChannelContext(source.channel as GuildBasedChannel | null),
      message: resolveMessageContext(source),
      timestamp: Date.now(),
      showTitle: false,
      showTimestamp: false,
      showTargetAvatar: true,
      files: files.length > 0 ? files : undefined,
      hideDetailsSection: true
    });
  }
}
