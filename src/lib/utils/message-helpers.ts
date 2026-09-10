import type { Message, PartialMessage, Attachment, Embed, Sticker } from 'discord.js';
import { container } from '@sapphire/pieces';

import { getEmoji } from '../../config/emojis.js';

/**
 * Safely fetch partial message
 */
export async function fetchPartialMessage(message: Message | PartialMessage): Promise<Message | null> {
  if (!message.partial) return message as Message;

  try {
    return await message.fetch();
  } catch (error) {
    const discordError = error as { code?: number; status?: number };
    if (discordError.code === 10008 || discordError.status === 404) {
      // Expected: Message not found (already deleted)
      return null;
    }
    container.logger.warn({ err: error }, 'Failed to fetch partial message');
    return null;
  }
}

/**
 * Format attachments for logging
 */
export function formatAttachments(attachments: Attachment[]): string[] {
  if (attachments.length === 0) return [];

  const lines: string[] = [];
  const images = attachments.filter((att) => att.contentType?.startsWith('image/'));
  const others = attachments.filter((att) => !att.contentType?.startsWith('image/'));

  if (images.length > 0) {
    lines.push(`> **Images:** ${images.length}`);
  }

  if (others.length > 0) {
    lines.push(`> **Files:** ${others.length}`);
  }

  return lines;
}

/**
 * Format embeds for logging with full content
 */
export function formatEmbeds(embeds: Embed[]): string[] {
  if (embeds.length === 0) return [];

  const lines: string[] = [``, `**Embeds (${embeds.length}):**`];

  for (const [i, embed] of embeds.entries()) {
    lines.push(``, `*Embed ${i + 1}*`);

    if (embed.title) lines.push(`│ **Title:** ${embed.title}`);
    if (embed.description) {
      const desc = embed.description.length > 200 ? `${embed.description.slice(0, 197)}...` : embed.description;
      lines.push(`│ **Description:** ${desc}`);
    }
    if (embed.url) lines.push(`│ **URL:** ${embed.url}`);
    if (embed.author?.name) lines.push(`│ **Author:** ${embed.author.name}`);
    if (embed.footer?.text) lines.push(`│ **Footer:** ${embed.footer.text}`);
    if (embed.fields && embed.fields.length > 0) {
      lines.push(`│ **Fields:** ${embed.fields.length}`);
      embed.fields.slice(0, 3).forEach((f) => {
        const val = f.value.length > 50 ? `${f.value.slice(0, 47)}...` : f.value;
        lines.push(`  │ ${f.name}: ${val}`);
      });
      if (embed.fields.length > 3) {
        lines.push(`  │ *...and ${embed.fields.length - 3} more*`);
      }
    }
    if (embed.image?.url) lines.push(`│ **Image:** [link](${embed.image.url})`);
    if (embed.thumbnail?.url) lines.push(`│ **Thumbnail:** [link](${embed.thumbnail.url})`);
  }

  return lines;
}

/**
 * Format stickers for logging
 */
export function formatStickers(stickers: Sticker[] | readonly Sticker[]): string[] {
  if (stickers.length === 0) return [];

  const stickerNames = Array.from(stickers)
    .map((s) => s.name)
    .join(', ');
  return [`> **Stickers:** ${stickerNames}`];
}

/**
 * Format content preview
 */
export function formatContentPreview(content: string | null, maxLength = 1000): string {
  if (!content || content.length === 0) return '*No content*';

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength - 3)}...`;
}

/**
 * Get channel name safely
 */
export function getChannelName(message: Message | PartialMessage): string {
  if ('name' in message.channel && message.channel.name) {
    return message.channel.name;
  }
  return message.channel.id;
}

/**
 * Check if message has meaningful content to log
 */
export function hasLogableContent(message: Message | PartialMessage): boolean {
  return Boolean(
    message.content ||
    (message.attachments && message.attachments.size > 0) ||
    (message.embeds && message.embeds.length > 0) ||
    (message.stickers && message.stickers.size > 0) ||
    ('components' in message && Array.isArray(message.components) && message.components.length > 0)
  );
}

const COMPACT_SNIPPET_MAX = 220;
const COMPACT_TITLE_MAX = 80;
const V2_TEXT_BLOCKS_MAX = 3;
const V2_TEXT_BLOCK_MAX = 600;
const V2_LABELS_MAX = 8;

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncateClean = (text: string, max: number): string => {
  const clean = collapseWhitespace(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

/**
 * Compact one-line-per-embed summary for delete logs.
 * WHY: the old pipe-wall dump was unreadable — title + snippet + counts only.
 */
export function formatEmbedSummary(embeds: Embed[]): string[] {
  if (embeds.length === 0) return [];
  const lines = [`**Embeds (${embeds.length})**`];
  embeds.slice(0, 3).forEach((embed, i) => {
    const title = embed.title?.trim() || 'Untitled';
    const extras: string[] = [];
    if (embed.fields?.length) extras.push(`${embed.fields.length} field${embed.fields.length === 1 ? '' : 's'}`);
    if (embed.image?.url || embed.thumbnail?.url) extras.push('media');
    const head = `${i + 1}. **${truncateClean(title, COMPACT_TITLE_MAX)}**${extras.length ? ` (${extras.join(' · ')})` : ''}`;
    if (embed.description?.trim()) lines.push(head, `> ${truncateClean(embed.description, COMPACT_SNIPPET_MAX)}`);
    else lines.push(head);
  });
  if (embeds.length > 3) lines.push(`*+${embeds.length - 3} more*`);
  return lines;
}

type V2Node = Record<string, unknown>;

const isObject = (value: unknown): value is V2Node => typeof value === 'object' && value !== null;

/**
 * Pull readable text out of raw Components V2 data (TextDisplay/Section content,
 * media gallery item descriptions). discord.js exposes these as untyped JSON,
 * so walk generically with a depth cap.
 */
export function extractV2ComponentText(components: readonly unknown[]): string[] {
  const texts: string[] = [];
  const walk = (nodes: readonly unknown[], depth: number): void => {
    if (depth > 4 || texts.length >= V2_TEXT_BLOCKS_MAX) return;
    for (const node of nodes) {
      if (texts.length >= V2_TEXT_BLOCKS_MAX) return;
      if (!isObject(node)) continue;
      if (typeof node.content === 'string' && node.content.trim()) {
        texts.push(node.content.trim().slice(0, V2_TEXT_BLOCK_MAX));
      }
      if (Array.isArray(node.components)) walk(node.components, depth + 1);
      if (isObject(node.accessory)) walk([node.accessory], depth + 1);
      if (Array.isArray(node.items)) {
        for (const item of node.items) {
          if (!isObject(item)) continue;
          if (typeof item.description === 'string' && item.description.trim()) {
            texts.push(`${getEmoji('embedMedia')} ${item.description.trim().slice(0, V2_TEXT_BLOCK_MAX)}`);
          }
        }
      }
    }
  };
  walk(components, 0);
  return texts;
}

const V2_SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

/**
 * Summarize interactive V2 controls (buttons, selects) as label chips.
 * WHY: proves what the deleted message offered without dumping raw JSON.
 */
export function summarizeV2Interactives(components: readonly unknown[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const clean = collapseWhitespace(label);
    if (!clean || seen.has(clean) || labels.length >= V2_LABELS_MAX) return;
    seen.add(clean);
    labels.push(clean);
  };
  const walk = (nodes: readonly unknown[], depth: number): void => {
    if (depth > 4) return;
    for (const node of nodes) {
      if (!isObject(node)) continue;
      if (node.type === 2 && typeof node.label === 'string') push(node.label);
      else if (typeof node.type === 'number' && V2_SELECT_TYPES.has(node.type)) {
        push(typeof node.placeholder === 'string' && node.placeholder ? node.placeholder : 'menu');
      }
      if (Array.isArray(node.components)) walk(node.components, depth + 1);
      if (isObject(node.accessory)) walk([node.accessory], depth + 1);
    }
  };
  walk(components, 0);
  return labels;
}

/**
 * Simple embed comparison using hash
 */
export function embedsAreDifferent(oldEmbeds: Embed[], newEmbeds: Embed[]): boolean {
  if (oldEmbeds.length !== newEmbeds.length) return true;

  // Quick hash-based comparison
  const oldHash = createEmbedHash(oldEmbeds);
  const newHash = createEmbedHash(newEmbeds);

  return oldHash !== newHash;
}

/**
 * Create hash from embeds for fast comparison
 */
function createEmbedHash(embeds: Embed[]): string {
  return embeds
    .map(
      (embed) =>
        `${embed.title}|${embed.description}|${embed.fields?.length || 0}|${embed.image?.url || ''}|${embed.thumbnail?.url || ''}`
    )
    .join('::');
}

/**
 * Format embed changes - shows old content first, then changes
 */
export function formatEmbedChanges(oldEmbeds: Embed[], newEmbeds: Embed[]): string[] {
  const lines: string[] = [];

  const maxLen = Math.max(oldEmbeds.length, newEmbeds.length);

  for (let i = 0; i < maxLen; i++) {
    const oldEmbed = oldEmbeds[i];
    const newEmbed = newEmbeds[i];

    if (i > 0) lines.push(``); // Empty line between embeds

    if (!oldEmbed && newEmbed) {
      // Embed added
      lines.push(`**Embed ${i + 1} (Added)**`);
      lines.push(...formatSingleEmbed(newEmbed));
    } else if (oldEmbed && !newEmbed) {
      // Embed removed
      lines.push(`**Embed ${i + 1} (Removed)**`);
      lines.push(...formatSingleEmbed(oldEmbed));
    } else if (oldEmbed && newEmbed) {
      // Embed modified - show old content first, then changes
      const changes = detectEmbedChanges(oldEmbed, newEmbed);

      if (changes.length > 0) {
        // Show embed header and old content
        lines.push(`**Embed ${i + 1}**`);
        lines.push(...formatSingleEmbed(oldEmbed));

        // Show changes section
        lines.push(``);
        lines.push(`**Embed Changes:**`);
        for (const change of changes) {
          lines.push(`│ **${change.field}:** ${change.before} → ${change.after}`);
        }
      }
    }
  }

  return lines;
}

/**
 * Format single embed content with full details
 */
function formatSingleEmbed(embed: Embed): string[] {
  const lines: string[] = [];

  if (embed.title) lines.push(`│ **Title:** ${embed.title}`);
  if (embed.description) {
    const desc = embed.description.length > 200 ? `${embed.description.slice(0, 197)}...` : embed.description;
    lines.push(`│ **Description:** ${desc}`);
  }
  if (embed.url) lines.push(`│ **URL:** ${embed.url}`);
  if (embed.color) {
    const hexColor = `#${embed.color.toString(16).padStart(6, '0')}`;
    lines.push(`│ **Color:** ${hexColor}`);
  }
  if (embed.author?.name) lines.push(`│ **Author:** ${embed.author.name}`);
  if (embed.footer?.text) lines.push(`│ **Footer:** ${embed.footer.text}`);
  if (embed.image?.url) lines.push(`│ **Image:** [View](${embed.image.url})`);
  if (embed.thumbnail?.url) lines.push(`│ **Thumbnail:** [View](${embed.thumbnail.url})`);
  if (embed.fields && embed.fields.length > 0) {
    lines.push(`│ **Fields:** ${embed.fields.length}`);
    embed.fields.slice(0, 2).forEach((f) => {
      const val = f.value.length > 40 ? `${f.value.slice(0, 37)}...` : f.value;
      lines.push(`  │ ${f.name}: ${val}`);
    });
    if (embed.fields.length > 2) {
      lines.push(`  │ *+${embed.fields.length - 2} more*`);
    }
  }

  // Show "No content" if embed is completely empty
  if (lines.length === 0) {
    lines.push(`│ *Empty embed*`);
  }

  return lines;
}

/**
 * Detect specific embed changes - only meaningful ones
 */
function detectEmbedChanges(oldEmbed: Embed, newEmbed: Embed): Array<{ field: string; before: string; after: string }> {
  const changes: Array<{ field: string; before: string; after: string }> = [];

  // Title change
  if (oldEmbed.title !== newEmbed.title) {
    changes.push({
      field: 'Title',
      before: oldEmbed.title || '*None*',
      after: newEmbed.title || '*None*'
    });
  }

  // Description change
  if (oldEmbed.description !== newEmbed.description) {
    const oldDesc = oldEmbed.description || '*None*';
    const newDesc = newEmbed.description || '*None*';
    changes.push({
      field: 'Description',
      before: oldDesc.length > 100 ? `${oldDesc.slice(0, 97)}...` : oldDesc,
      after: newDesc.length > 100 ? `${newDesc.slice(0, 97)}...` : newDesc
    });
  }

  // URL change
  if (oldEmbed.url !== newEmbed.url) {
    changes.push({
      field: 'URL',
      before: oldEmbed.url || '*None*',
      after: newEmbed.url || '*None*'
    });
  }

  // Color change
  if (oldEmbed.color !== newEmbed.color) {
    const oldColor = oldEmbed.color ? `#${oldEmbed.color.toString(16).padStart(6, '0')}` : '*None*';
    const newColor = newEmbed.color ? `#${newEmbed.color.toString(16).padStart(6, '0')}` : '*None*';
    changes.push({
      field: 'Color',
      before: oldColor,
      after: newColor
    });
  }

  // Author change
  if (oldEmbed.author?.name !== newEmbed.author?.name) {
    changes.push({
      field: 'Author',
      before: oldEmbed.author?.name || '*None*',
      after: newEmbed.author?.name || '*None*'
    });
  }

  // Footer change
  if (oldEmbed.footer?.text !== newEmbed.footer?.text) {
    changes.push({
      field: 'Footer',
      before: oldEmbed.footer?.text || '*None*',
      after: newEmbed.footer?.text || '*None*'
    });
  }

  // Image change
  if (oldEmbed.image?.url !== newEmbed.image?.url) {
    const oldImg = oldEmbed.image?.url;
    const newImg = newEmbed.image?.url;
    changes.push({
      field: 'Image',
      before: oldImg ? `[Link](${oldImg})` : '*None*',
      after: newImg ? `[Link](${newImg})` : '*None*'
    });
  }

  // Thumbnail change
  if (oldEmbed.thumbnail?.url !== newEmbed.thumbnail?.url) {
    const oldThumb = oldEmbed.thumbnail?.url;
    const newThumb = newEmbed.thumbnail?.url;
    changes.push({
      field: 'Thumbnail',
      before: oldThumb ? `[Link](${oldThumb})` : '*None*',
      after: newThumb ? `[Link](${newThumb})` : '*None*'
    });
  }

  // Fields count change - only show if meaningful (not 0→0 and actually changed)
  const oldFieldsCount = oldEmbed.fields?.length || 0;
  const newFieldsCount = newEmbed.fields?.length || 0;
  if (oldFieldsCount !== newFieldsCount && !(oldFieldsCount === 0 && newFieldsCount === 0)) {
    changes.push({
      field: 'Fields',
      before: `${oldFieldsCount} field${oldFieldsCount !== 1 ? 's' : ''}`,
      after: `${newFieldsCount} field${newFieldsCount !== 1 ? 's' : ''}`
    });
  }

  return changes;
}
