import {
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder
} from 'discord.js';

import { theme } from '../config/theme.js';
import { getEmoji } from '../config/emojis.js';
import { toast } from './single-line-embed.js';

export type EmbedKind = 'primary' | 'success' | 'warning' | 'danger' | 'info';

// ── Named constants (WHY: single source for Discord limits & styling caps) ──
const EMBED_FIELD_VALUE_MAX_LENGTH = 120;
const GALLERY_MAX_IMAGES = 10;
const GALLERY_IMAGE_ALT_TEXT = 'image';

const KIND_FALLBACK_EMOJI: Record<EmbedKind, string> = {
  primary: getEmoji('fallbackInfo'),
  info: getEmoji('fallbackInfo'),
  success: getEmoji('fallbackSuccess'),
  warning: getEmoji('fallbackWarning'),
  danger: getEmoji('fallbackDanger')
};

/** Resolves theme color for an embed kind — falls back to primary. */
const resolveKindColor = (kind: EmbedKind): number => theme.colors[kind] ?? theme.colors.primary;

/** Resolves emoji for embed kind via theme, falls back to built-in map. */
const resolveKindEmoji = (kind: EmbedKind): string => getEmoji(kind as never) || KIND_FALLBACK_EMOJI[kind] || '';

/**
 * Single-line toast — delegates to the canonical toast() in single-line-embed.js.
 * WHY: one implementation for all one-line outcomes; embeds.ts keeps only V2 below.
 */
export const createSingleLineEmbedResponse = (
  description: string,
  kind: EmbedKind = 'info',
  ephemeral: boolean = false
): unknown => (ephemeral ? toast(kind, description, true) : toast(kind, description));

/**
 * Creates a legacy rich embed with optional title prefix and footer.
 * WHY: centralized heading style (emoji + markdown) keeps legacy paths consistent.
 */
export const createRichEmbed = (options: {
  title?: string;
  description: string;
  kind?: EmbedKind;
  timestamp?: boolean;
  footer?: string;
  thumbnail?: string | null;
}): EmbedBuilder => {
  const embedKind = options.kind ?? 'info';
  const kindEmoji = resolveKindEmoji(embedKind);
  const embedColor = resolveKindColor(embedKind);
  const titlePrefix = options.title ? `### ${kindEmoji} ${options.title}` : '';
  const combinedDescription = [titlePrefix, options.description].filter(Boolean).join('\n');

  const embedBuilder = new EmbedBuilder().setColor(embedColor).setDescription(combinedDescription);

  if (options.footer) embedBuilder.setFooter({ text: options.footer });
  if (options.timestamp) embedBuilder.setTimestamp(new Date());
  if (options.thumbnail) embedBuilder.setThumbnail(options.thumbnail);

  return embedBuilder;
};

interface ContainerEmbedOptions {
  title: string;
  subtitle?: string;
  accent?: EmbedKind;
  accentColor?: number;
  thumbnailUrl?: string | null;
  thumbnailAlt?: string;
  fields?: { name: string; value: string; icon?: string }[];
  blocks?: string[];
  bannerUrl?: string | null;
  galleryUrls?: string[];
  footer?: string;
  ephemeral?: boolean;
}

/** Builds header markdown for V2 containers (emoji + title + muted subtitle). */
const buildContainerHeaderText = (options: ContainerEmbedOptions): string => {
  const headerEmoji = resolveKindEmoji(options.accent ?? 'primary');
  const subtitlePart = options.subtitle ? `\n-# ${options.subtitle}` : '';
  return `## ${headerEmoji} ${options.title}${subtitlePart}`;
};

/** Formats fields into a single inline-code line; returns null when none. */
const buildFieldsContent = (fields: ContainerEmbedOptions['fields']): string | null => {
  if (!fields?.length) return null;
  return fields
    .map((field) => {
      const fieldIcon = field.icon ? `${resolveKindEmoji(field.icon as EmbedKind)} ` : '';
      const sanitizedValue = field.value.slice(0, EMBED_FIELD_VALUE_MAX_LENGTH).replace(/`/g, "'");
      const isDiscordMarkdown =
        sanitizedValue.includes('<t:') ||
        sanitizedValue.includes('<@') ||
        sanitizedValue.includes('<:') ||
        sanitizedValue.includes('<a:');
      return isDiscordMarkdown
        ? `**${fieldIcon}${field.name}:** ${sanitizedValue}`
        : `**${fieldIcon}${field.name}:** \`${sanitizedValue}\``;
    })
    .join('  •  ');
};

/** Appends header with optional thumbnail accessory; early return when no thumbnail. */
const appendThumbnailSection = (
  container: ContainerBuilder,
  headerText: string,
  options: ContainerEmbedOptions
): void => {
  if (!options.thumbnailUrl) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    return;
  }

  const thumbnailSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(options.thumbnailUrl).setDescription(options.thumbnailAlt ?? options.title)
    );
  container.addSectionComponents(thumbnailSection);
};

/** Appends fields line if present — early return keeps caller flat. */
const appendFieldsSection = (container: ContainerBuilder, fieldsContent: string | null): void => {
  if (!fieldsContent) return;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsContent));
};

/** Appends block sections with subtle dividers between them. */
const appendBlocksSection = (container: ContainerBuilder, blocks: string[] | undefined, hasFields: boolean): void => {
  if (!blocks?.length) return;
  if (hasFields) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  }

  blocks.forEach((blockContent, blockIndex) => {
    if (blockIndex > 0) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    }
    if (!blockContent?.trim()) return;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(blockContent));
  });
};

/** Appends gallery or single banner image (capped at GALLERY_MAX_IMAGES). */
const appendGallerySection = (container: ContainerBuilder, options: ContainerEmbedOptions): void => {
  const gallerySources = options.galleryUrls?.length
    ? options.galleryUrls
    : options.bannerUrl
      ? [options.bannerUrl]
      : [];
  if (!gallerySources.length) return;

  const mediaGallery = new MediaGalleryBuilder();
  for (const imageUrl of gallerySources.slice(0, GALLERY_MAX_IMAGES)) {
    mediaGallery.addItems(new MediaGalleryItemBuilder().setURL(imageUrl).setDescription(GALLERY_IMAGE_ALT_TEXT));
  }
  container.addMediaGalleryComponents(mediaGallery);
};

/** Appends muted footer line; early return when none. */
const appendFooterSection = (container: ContainerBuilder, footer: string | undefined): void => {
  if (!footer) return;
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
};

/**
 * Patches ContainerBuilder's internal data for Jest/discord.js quirk
 * WHY: toJSON() returns normalized components but .data can stay stale in tests.
 */
const patchContainerDataForTest = (container: ContainerBuilder): void => {
  try {
    const jsonData = container.toJSON() as { components?: unknown[] };
    if (!jsonData.components?.length) return;
    (container as unknown as { data: Record<string, unknown> }).data.components = [...jsonData.components];
  } catch {
    // Ignore patch errors — WHY: safe to no-op outside test env
  }
};

/**
 * Creates a V2 container embed — accent-driven, thumbnail-aware, gallery-capable.
 * Orchestrates helpers above; stays <50 lines via delegation & early returns.
 */
export const createContainerEmbed = (options: ContainerEmbedOptions) => {
  try {
    const accentColor = options.accentColor ?? resolveKindColor(options.accent ?? 'primary');
    const containerBuilder = new ContainerBuilder().setAccentColor(accentColor);
    const headerText = buildContainerHeaderText(options);

    appendThumbnailSection(containerBuilder, headerText, options);
    containerBuilder.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const fieldsContent = buildFieldsContent(options.fields);
    appendFieldsSection(containerBuilder, fieldsContent);
    appendBlocksSection(containerBuilder, options.blocks, Boolean(fieldsContent));
    appendGallerySection(containerBuilder, options);
    appendFooterSection(containerBuilder, options.footer);
    patchContainerDataForTest(containerBuilder);

    const baseFlags = MessageFlags.IsComponentsV2;
    const finalFlags = options.ephemeral ? baseFlags | MessageFlags.Ephemeral : baseFlags;
    return { components: [containerBuilder], flags: finalFlags } as const;
  } catch {
    // Fallback container — WHY: never let embed creation crash the command
    const fallbackContainer = new ContainerBuilder().setAccentColor(resolveKindColor('info'));
    fallbackContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${options.title}`));
    patchContainerDataForTest(fallbackContainer);
    return { components: [fallbackContainer], flags: MessageFlags.IsComponentsV2 } as const;
  }
};

export const createLegacyEmbed = (options: {
  title?: string;
  description: string;
  type?: EmbedKind;
  footer?: string;
  timestamp?: boolean;
}): EmbedBuilder =>
  createRichEmbed({
    title: options.title,
    description: options.description,
    kind: options.type ?? 'info',
    footer: options.footer,
    timestamp: options.timestamp
  });

// Backward-compatible aliases for existing imports
export const single = createSingleLineEmbedResponse;
export const rich = createRichEmbed;
export const v2 = createContainerEmbed;
export const legacy = createLegacyEmbed;

// ── V2 logging factory (sleek minimal) ── also available in src/config/logging.ts
// Re-export helper: use same implementation as logging.ts but kept local to avoid circular dynamic import.
export { buildLogV2Container as buildLogV2 } from '../config/logging.js';
