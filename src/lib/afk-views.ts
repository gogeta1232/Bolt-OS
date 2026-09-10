import {
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';

import { getEmoji } from '../config/emojis.js';
import { theme } from '../config/theme.js';

const MAX_AFK_MESSAGE_LENGTH = 200;

const patchContainer = (container: ContainerBuilder): ContainerBuilder => {
  try {
    const json = container.toJSON() as { components?: unknown[] };
    if (json.components?.length)
      (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
  } catch {
    void 0;
  }
  return container;
};

export const buildAfkSetContainer = (opts: {
  userTag: string;
  userId: string;
  message: string;
  attachmentUrl?: string | null;
  isEphemeral?: boolean;
  guildName?: string;
}): { embeds: [EmbedBuilder]; flags?: number } => {
  const emoji = getEmoji('afk') || getEmoji('sleep');
  const rawReason = opts.message.trim() || 'AFK';
  const filename = opts.attachmentUrl ? (opts.attachmentUrl.split('/').pop()?.split('?')[0]?.toLowerCase() ?? '') : '';
  const lowerReason = rawReason.toLowerCase();
  // Hide reason if it's just the attachment filename/url (e.g., "10e0677e...gif" or full CDN URL)
  const isReasonJustFile =
    !!opts.attachmentUrl &&
    (lowerReason === opts.attachmentUrl.toLowerCase() ||
      lowerReason === filename ||
      filename.includes(lowerReason) ||
      lowerReason.includes(filename.replace('.gif', '').replace('.png', '').replace('.jpg', '')) ||
      /^[a-f0-9-]{20,}\.g?i?f?$/.test(lowerReason));
  const displayReason = isReasonJustFile
    ? '*AFK*'
    : `*${rawReason.replace(/`/g, "'").slice(0, MAX_AFK_MESSAGE_LENGTH)}*`;
  const singleLine = `${emoji} │ You are now AFK — ${displayReason}`;
  const embed = new EmbedBuilder().setColor(theme.colors.primary).setDescription(singleLine);
  if (opts.attachmentUrl) {
    // Normal embed handles GIF correctly via setImage (supports attachment:// and external https://)
    embed.setImage(opts.attachmentUrl);
  }
  const flags = opts.isEphemeral ? MessageFlags.Ephemeral : undefined;
  return { embeds: [embed] as [EmbedBuilder], flags };
};

export const buildAfkMentionContainer = (opts: {
  username: string;
  userId: string;
  message: string;
  attachmentUrl?: string | null;
  setAt: Date;
}): { components: [ContainerBuilder]; flags: number } => {
  const container = new ContainerBuilder().setAccentColor(theme.colors.warning);
  const emoji = getEmoji('afk') || getEmoji('sleep');
  const ts = Math.floor(opts.setAt.getTime() / 1000);
  const rawReason = opts.message.trim() || 'AFK';
  const filename = opts.attachmentUrl ? (opts.attachmentUrl.split('/').pop()?.split('?')[0]?.toLowerCase() ?? '') : '';
  const lowerReason = rawReason.toLowerCase();
  const isReasonJustFile =
    !!opts.attachmentUrl &&
    (lowerReason === opts.attachmentUrl.toLowerCase() ||
      lowerReason === filename ||
      filename.includes(lowerReason) ||
      lowerReason.includes(filename.replace('.gif', '').replace('.png', '').replace('.jpg', '')) ||
      /^[a-f0-9-]{20,}\.g?i?f?$/.test(lowerReason));
  const displayReason = isReasonJustFile
    ? '*AFK*'
    : `*${rawReason.replace(/`/g, "'").slice(0, MAX_AFK_MESSAGE_LENGTH)}*`;
  const singleLine = `${emoji} │ ${opts.username} is AFK — ${displayReason} · <t:${ts}:R>`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(singleLine));
  if (opts.attachmentUrl) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    const gallery = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(opts.attachmentUrl).setDescription('AFK image')
    );
    container.addMediaGalleryComponents(gallery);
  }
  patchContainer(container);
  return { components: [container] as unknown as [ContainerBuilder], flags: MessageFlags.IsComponentsV2 };
};

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export const isImageAttachment = (attachment: {
  contentType?: string | null;
  name?: string | null;
  url: string;
}): boolean => {
  const ct = attachment.contentType?.toLowerCase() ?? '';
  const name = attachment.name?.toLowerCase() ?? '';
  const ext = name.split('.').pop() ?? '';
  if (ct.startsWith('video/')) {
    // Allow gif that Discord serves as video/mp4 (common for Tenor)
    if (ext === 'gif') return true;
    return false;
  }
  if (ct.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(ext);
};

export const extractImageUrlFromText = (text: string): string | null => {
  const urlRegex = /https?:\/\/[^\s<>()]+/gi;
  const matches = text.match(urlRegex);
  if (!matches) return null;
  for (const url of matches) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      if ([...IMAGE_EXTENSIONS].some((ext) => pathname.endsWith(`.${ext}`))) return url;
    } catch {
      continue;
    }
  }
  return null;
};
