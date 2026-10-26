import { createHash } from 'node:crypto';
import type { Message, PartialMessage } from 'discord.js';

import { embedLogState } from './utils/message-helpers.js';

export const isOwnMessage = (message: Message | PartialMessage, botId: string | undefined): boolean =>
  Boolean(botId && message.author?.id === botId);

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// These fields describe presentation or interaction choices, not delivery metadata.
const COMPONENT_FIELDS = new Set([
  'type',
  'content',
  'label',
  'style',
  'emoji',
  'url',
  'disabled',
  'placeholder',
  'options',
  'description',
  'default',
  'default_values',
  'channel_types',
  'min_values',
  'max_values',
  'components',
  'accessory',
  'items',
  'media',
  'file',
  'spoiler',
  'sku_id'
]);

const mediaKey = (url: string, message: Message): string => {
  const attachment = [...message.attachments.values()].find(
    (file) => url === `attachment://${file.name}` || url === file.url || url === file.proxyURL
  );
  if (attachment) return `attachment:${attachment.id}`;
  try {
    const parsed = new URL(url);
    if (
      ['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname) &&
      parsed.pathname.startsWith('/attachments/')
    ) {
      return `attachment:${parsed.pathname.split('/')[3]}`;
    }
  } catch {
    // Attachment references and malformed URLs still compare as literal values.
  }
  return url;
};

function normalizeComponent(value: unknown, message: Message, field = '', depth = 0): unknown {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((item) => normalizeComponent(item, message, field, depth + 1));
  if (!record(value)) return value;
  if (field === 'media' || field === 'file') {
    return typeof value.url === 'string' ? { url: mediaKey(value.url, message) } : null;
  }
  const fields =
    field === 'emoji' || field === 'default_values' ? ['id', 'name', 'animated', 'type'] : [...COMPONENT_FIELDS];
  return Object.fromEntries(
    fields.sort().flatMap((key) => {
      if (!(key in value)) return [];
      // Missing and explicit defaults represent the same visible control state.
      if (['disabled', 'spoiler', 'default'].includes(key) && value[key] === false) return [];
      return [[key, normalizeComponent(value[key], message, key, depth + 1)]];
    })
  );
}

export const messageComponentState = (message: Message): string =>
  JSON.stringify(
    normalizeComponent(
      message.components.map((component) => component.toJSON()),
      message
    )
  );

const attachmentState = (message: Message): string =>
  JSON.stringify(
    [...message.attachments.values()].map((file) => [file.id, file.name, file.description, file.spoiler]).sort()
  );
const stickerState = (message: Message): string => JSON.stringify([...message.stickers.keys()].sort());

export interface MessageLogChanges {
  content: boolean;
  embeds: boolean;
  components: boolean;
  attachments: boolean;
  stickers: boolean;
  revision: string;
}

/** Compare author-visible state; IDs assigned to components and media hydration are not edits. */
export function messageLogChanges(before: Message, after: Message): MessageLogChanges {
  const components = messageComponentState(after);
  const attachments = attachmentState(after);
  const stickers = stickerState(after);
  const embeds = embedLogState(after.embeds);
  return {
    content: before.content !== after.content,
    embeds: embedLogState(before.embeds) !== embeds,
    components: messageComponentState(before) !== components,
    attachments: attachmentState(before) !== attachments,
    stickers: stickerState(before) !== stickers,
    revision: createHash('sha256')
      .update(JSON.stringify([after.content, components, attachments, stickers, embeds]))
      .digest('hex')
  };
}
