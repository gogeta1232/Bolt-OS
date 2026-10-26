import {
  escapeMarkdown,
  type Message,
  type PartialMessage,
  type Attachment,
  type Embed,
  type Sticker
} from 'discord.js';
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
export function extractV2ComponentText(
  components: readonly unknown[],
  maxBlocks = V2_TEXT_BLOCKS_MAX,
  maxLength = V2_TEXT_BLOCK_MAX
): string[] {
  const texts: string[] = [];
  const walk = (nodes: readonly unknown[], depth: number): void => {
    if (depth > 4 || texts.length >= maxBlocks) return;
    for (const node of nodes) {
      if (texts.length >= maxBlocks) return;
      if (!isObject(node)) continue;
      if (typeof node.content === 'string' && node.content.trim()) {
        texts.push(node.content.trim().slice(0, maxLength));
      }
      if (Array.isArray(node.components)) walk(node.components, depth + 1);
      if (isObject(node.accessory)) walk([node.accessory], depth + 1);
      if (Array.isArray(node.items)) {
        for (const item of node.items) {
          if (!isObject(item)) continue;
          if (typeof item.description === 'string' && item.description.trim()) {
            texts.push(`${getEmoji('embedMedia')} ${item.description.trim().slice(0, maxLength)}`);
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
export function summarizeV2Interactives(components: readonly unknown[], maxLabels = V2_LABELS_MAX): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const clean = collapseWhitespace(label);
    if (!clean || seen.has(clean) || labels.length >= maxLabels) return;
    seen.add(clean);
    labels.push(clean);
  };
  const walk = (nodes: readonly unknown[], depth: number): void => {
    if (depth > 4) return;
    for (const node of nodes) {
      if (!isObject(node)) continue;
      if (node.type === 2 && typeof node.label === 'string') {
        push(`${node.label}${node.disabled === true ? ' (disabled)' : ''}`);
      } else if (typeof node.type === 'number' && V2_SELECT_TYPES.has(node.type)) {
        const placeholder = typeof node.placeholder === 'string' && node.placeholder ? node.placeholder : 'menu';
        push(`${placeholder}${node.disabled === true ? ' (disabled)' : ''}`);
        if (Array.isArray(node.options)) {
          for (const option of node.options) {
            if (isObject(option) && typeof option.label === 'string') push(option.label);
          }
        }
      }
      if (Array.isArray(node.components)) walk(node.components, depth + 1);
      if (isObject(node.accessory)) walk([node.accessory], depth + 1);
    }
  };
  walk(components, 0);
  return labels;
}

/** Message body across text, embeds and Components V2 for edit previews. */
export function formatMessageEditSnapshot(message: Message): string {
  const lines: string[] = [];
  if (message.content) lines.push(message.content.trim() ? message.content : '*Whitespace-only text*');
  for (const embed of message.embeds) {
    lines.push(...embedProperties(embed).flatMap(([label, value]) => (value === null ? [] : [`${label}: ${value}`])));
  }
  const components = message.components.map((component) => component.toJSON());
  lines.push(...extractV2ComponentText(components, 40, 4000), ...componentMediaPreview(components));
  const labels = summarizeV2Interactives(components, 40);
  if (labels.length) lines.push(labels.join(' · '));
  lines.push(
    ...[...message.attachments.values()].map(
      (file) =>
        `Attachment: ${file.name} (ID ${file.id}${file.spoiler ? ', spoiler' : ''})${file.description ? `\nDescription: ${file.description}` : ''}`
    )
  );
  lines.push(...[...message.stickers.values()].map((sticker) => `Sticker: ${sticker.name} (ID ${sticker.id})`));
  if (!lines.length && message.components.length) lines.push('*Non-text components*');
  return lines.join('\n\n') || '*Message body cleared*';
}

function componentMediaPreview(components: readonly unknown[], depth = 0): string[] {
  if (depth > 4) return [];
  const lines: string[] = [];
  for (const node of components) {
    if (!isObject(node)) continue;
    for (const media of [node.media, node.file]) {
      if (isObject(media) && typeof media.url === 'string') {
        lines.push(
          media.url.startsWith('attachment://')
            ? `Attachment: ${media.url.slice('attachment://'.length)}`
            : `Media: ${embedLink(media.url, 'View')}`
        );
      }
    }
    if (Array.isArray(node.components)) lines.push(...componentMediaPreview(node.components, depth + 1));
    if (Array.isArray(node.items)) lines.push(...componentMediaPreview(node.items, depth + 1));
    if (isObject(node.accessory)) lines.push(...componentMediaPreview([node.accessory], depth + 1));
  }
  return lines;
}

type EmbedProperty = readonly [label: string, value: string | null];

const embedProperties = (embed: Embed): EmbedProperty[] => [
  ['Title', embed.title],
  ['Description', embed.description],
  ['URL', embed.url],
  ['Color', embed.color === null ? null : '#' + embed.color.toString(16).padStart(6, '0')],
  ['Author', embed.author?.name ?? null],
  ['Author URL', embed.author?.url ?? null],
  ['Author icon', embed.author?.iconURL ?? null],
  ['Footer', embed.footer?.text ?? null],
  ['Footer icon', embed.footer?.iconURL ?? null],
  ['Image', embed.image?.url ?? null],
  ['Thumbnail', embed.thumbnail?.url ?? null],
  ['Timestamp', embed.timestamp],
  ...embed.fields.map((field, index): EmbedProperty => [
    'Field ' + (index + 1),
    field.name + ': ' + field.value + (field.inline ? ' (inline)' : '')
  ])
];

/** Compare readable embed data, ignoring Discord's automatic media proxy metadata. */
export function embedsAreDifferent(oldEmbeds: Embed[], newEmbeds: Embed[]): boolean {
  return embedLogState(oldEmbeds) !== embedLogState(newEmbeds);
}

export const embedLogState = (embeds: readonly Embed[]): string => JSON.stringify(embeds.map(embedProperties));

const embedPreview = (value: string | null, maximum = 180): string =>
  value === null ? '*None*' : escapeMarkdown(truncateClean(value, maximum));

/** Retain complete evidence whenever a compact preview omits content. */
export function formatEmbedEditTranscript(oldEmbeds: Embed[], newEmbeds: Embed[]): string | null {
  const fullContent = (embeds: Embed[]): string =>
    embeds
      .map((embed, index) =>
        [
          `Embed ${index + 1}`,
          ...embedProperties(embed).flatMap(([label, value]) => (value === null ? [] : [`${label}: ${value}`]))
        ].join('\n')
      )
      .join('\n\n') || 'No embeds';
  const transcript = `BEFORE\n\n${fullContent(oldEmbeds)}\n\nAFTER\n\n${fullContent(newEmbeds)}`;
  const truncated = [...oldEmbeds, ...newEmbeds].some(
    (embed) =>
      (embed.title?.length ?? 0) > 100 ||
      (embed.description?.length ?? 0) > 260 ||
      (embed.author?.name.length ?? 0) > 100 ||
      (embed.footer?.text.length ?? 0) > 140 ||
      embed.fields.length > 5 ||
      embedProperties(embed).some(([, value]) => (value?.length ?? 0) > 512) ||
      embed.fields.some((field) => field.name.length > 60 || field.value.length > 160)
  );
  return truncated || transcript.length > 600 ? transcript : null;
}

const contentPreview = (value: string, maximum: number): string =>
  truncateClean(value, maximum).replace(/^#{1,6}\s+/, '');

/** Readable embed content; preserve inline Discord formatting and custom emojis. */
function formatEmbedSnapshot(embed: Embed, changed?: ReadonlySet<string>): string[] {
  const lines: string[] = [];
  const includes = (property: string): boolean => !changed || changed.has(property);
  if (includes('Title') && embed.title) lines.push('> **' + embedPreview(embed.title, 100) + '**');
  if (includes('Author') && embed.author?.name) lines.push('> ' + embedPreview(embed.author.name, 100));
  if (includes('Description') && embed.description) lines.push('> ' + contentPreview(embed.description, 260));
  let shown = 0;
  let omitted = 0;
  embed.fields.forEach((field, index) => {
    if (!includes('Field ' + (index + 1))) return;
    if (shown >= 5) {
      omitted++;
      return;
    }
    lines.push('> **' + embedPreview(field.name || 'Untitled field', 60) + ':** ' + contentPreview(field.value, 160));
    shown++;
  });
  if (includes('Footer') && embed.footer?.text) lines.push('> *' + embedPreview(embed.footer.text, 140) + '*');
  if (omitted) lines.push('> *+' + omitted + ' more fields in attachment*');
  const bounded: string[] = [];
  for (const line of lines) {
    if (bounded.join('\n').length + line.length > 1100) {
      bounded.push('> *More content in attachment*');
      break;
    }
    bounded.push(line);
  }
  return bounded.length ? bounded : ['> *No text*'];
}

const embedLink = (value: string, label: string): string => {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.href.length > 512) return '*Unavailable*';
    return '[' + label + '](<' + url.href.replace(/[<>]/g, encodeURIComponent) + '>)';
  } catch {
    return '*Unavailable*';
  }
};

const TEXT_PROPERTIES = new Set(['Title', 'Description', 'Author', 'Footer']);
const LINK_PROPERTIES = new Set(['URL', 'Author URL', 'Author icon', 'Footer icon', 'Image', 'Thumbnail']);

function formatEmbedMetadata(before: Embed | undefined, after: Embed | undefined): string[] {
  const oldProperties = new Map(before ? embedProperties(before) : []);
  const newProperties = new Map(after ? embedProperties(after) : []);
  const lines: string[] = [];
  for (const property of [
    'URL',
    'Color',
    'Author URL',
    'Author icon',
    'Footer icon',
    'Image',
    'Thumbnail',
    'Timestamp'
  ]) {
    const oldValue = oldProperties.get(property) ?? null;
    const newValue = newProperties.get(property) ?? null;
    if (oldValue === newValue) continue;
    if (LINK_PROPERTIES.has(property)) {
      const state = !oldValue ? 'added' : !newValue ? 'removed' : 'changed';
      const links = [
        oldValue ? embedLink(oldValue, 'Before') : '',
        newValue ? embedLink(newValue, 'After') : ''
      ].filter(Boolean);
      const label = '-# ' + property + ' ' + state;
      const detail = label + ' · ' + links.join(' · ');
      lines.push(lines.join('\n').length + detail.length > 600 ? label : detail);
    } else {
      lines.push('-# ' + property + ': ' + embedPreview(oldValue, 40) + ' → ' + embedPreview(newValue, 40));
    }
  }
  return lines;
}

/** Separate old and new content into readable views instead of positional field diffs. */
export function formatEmbedChanges(oldEmbeds: Embed[], newEmbeds: Embed[]): string[] {
  const groups: string[][] = [];
  const count = Math.max(oldEmbeds.length, newEmbeds.length);
  for (let index = 0; index < count; index++) {
    const before = oldEmbeds[index];
    const after = newEmbeds[index];
    const label = count === 1 ? 'Embed' : 'Embed ' + (index + 1);
    if (!before && after) {
      groups.push(['-# ' + label + ' added', ...formatEmbedSnapshot(after), ...formatEmbedMetadata(before, after)]);
    } else if (before && !after) {
      groups.push(['-# ' + label + ' removed', ...formatEmbedSnapshot(before), ...formatEmbedMetadata(before, after)]);
    } else if (before && after) {
      const oldProperties = new Map(embedProperties(before));
      const newProperties = new Map(embedProperties(after));
      const labels = new Set([...oldProperties.keys(), ...newProperties.keys()]);
      const changed = new Set(
        [...labels].filter((property) => oldProperties.get(property) !== newProperties.get(property))
      );
      if (!changed.size) continue;
      const contentChanged = [...changed].some(
        (property) => TEXT_PROPERTIES.has(property) || property.startsWith('Field ')
      );
      const lines = ['-# ' + label + ' updated'];
      if (contentChanged) {
        lines.push(
          '**Before**',
          ...formatEmbedSnapshot(before, changed),
          '',
          '**After**',
          ...formatEmbedSnapshot(after, changed)
        );
      }
      lines.push(...formatEmbedMetadata(before, after));
      groups.push(lines);
    }
  }
  const lines: string[] = [];
  for (const [index, group] of groups.entries()) {
    if (lines.join('\n').length + group.join('\n').length > 3300) {
      lines.push('-# +' + (groups.length - index) + ' more embed changes in attachment');
      break;
    }
    if (index) lines.push('');
    lines.push(...group);
  }
  return lines;
}
