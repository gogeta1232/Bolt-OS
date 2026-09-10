import {
  ComponentType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type AttachmentBuilder,
  type GuildBasedChannel,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type Snowflake,
  type User
} from 'discord.js';

import { createEmbed, theme } from './theme.js';
import { getEmoji, type EmojiKey } from './emojis.js';

export type LogContext = {
  actor?: User | null;
  target?: User | null;
  channel?: { id: Snowflake; name?: string | null } | null;
  message?: {
    id: Snowflake;
    url?: string;
    content?: string | null;
    createdTimestamp?: number;
    editedTimestamp?: number | null;
    embeds?: import('discord.js').Embed[];
  } | null;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  reason?: string | null;
  caseId?: number | null;
  duration?: string | null;
  /** Explicit ID for the log footer (e.g. role/channel ID when no message/target applies). */
  subjectId?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  timestamp?: number | null;
  showActorAvatar?: boolean;
  showTargetAvatar?: boolean;
  showTitle?: boolean;
  showTimestamp?: boolean;
  files?: AttachmentBuilder[];
  emojiIconUrl?: string | null;
  hideDetailsSection?: boolean;
  galleryUrls?: string[];
};

export type LogType =
  | 'audit'
  | 'moderation'
  | 'administrative'
  | 'messageDelete'
  | 'messageEdit'
  | 'reaction'
  | 'memberJoin'
  | 'memberLeave'
  | 'memberUpdate'
  | 'channelCreate'
  | 'channelDelete'
  | 'channelUpdate'
  | 'channel'
  | 'emoji'
  | 'cases'
  | 'role'
  | 'guild'
  | 'voice';

export const logTypeEmoji: Record<LogType, keyof typeof theme.colors> = {
  audit: 'info',
  moderation: 'danger',
  administrative: 'warning',
  messageDelete: 'warning',
  messageEdit: 'info',
  reaction: 'info',
  memberJoin: 'success',
  memberLeave: 'warning',
  memberUpdate: 'info',
  channel: 'info',
  channelCreate: 'success',
  channelDelete: 'danger',
  channelUpdate: 'info',
  emoji: 'info',
  cases: 'info',
  role: 'info',
  guild: 'info',
  voice: 'info'
};

export const logTypeTitle: Record<LogType, string> = {
  audit: `${getEmoji('audit')} Audit Log`,
  moderation: `${getEmoji('danger')} Moderation Action`,
  administrative: `${getEmoji('settings')} Administrative Action`,
  messageDelete: `${getEmoji('deletion')} Message Deleted`,
  messageEdit: `${getEmoji('message')} Message Edited`,
  reaction: `${getEmoji('reaction')} Reaction Update`,
  memberJoin: `${getEmoji('welcome')} Member Joined`,
  memberLeave: `${getEmoji('goodbye')} Member Left`,
  memberUpdate: `${getEmoji('member')} Member Update`,
  channel: `${getEmoji('channel')} Channel Update`,
  channelCreate: `${getEmoji('channel')} Channel Created`,
  channelDelete: `${getEmoji('channel')} Channel Deleted`,
  channelUpdate: `${getEmoji('channel')} Channel Updated`,
  emoji: `${getEmoji('emoji')} Emoji Update`,
  cases: `${getEmoji('case')} Case Update`,
  role: `${getEmoji('role')} Role Update`,
  guild: `${getEmoji('settings')} Guild Update`,
  voice: `${getEmoji('voice')} Voice Activity`
};

export const formatContentPreview = (content?: string | null) => {
  if (!content) return '*(no content)*';
  if (content.length <= 1900) return content;
  return `${content.slice(0, 1897)}...`;
};

export const formatPermissionName = (permission: string): string =>
  permission
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const LOG_AVATAR_SIZE = 128;
const LOG_CONTENT_PREVIEW_TRUNCATE_LENGTH = 50;

const formatRelativeTimestamp = (timestamp?: number | null) =>
  timestamp ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'Unknown time';

export const resolveChannelContext = (channel: GuildBasedChannel | null | undefined) => {
  if (!channel) return null;
  if (!('id' in channel)) return null;
  const name = 'name' in channel ? channel.name : null;
  return { id: channel.id, name };
};

export const resolveMessageContext = (message: Message | PartialMessage | null | undefined) => {
  if (!message) return null;
  if (!('id' in message)) return null;
  return {
    id: message.id,
    url: 'url' in message ? (message.url ?? undefined) : undefined,
    content: 'content' in message ? message.content : null,
    createdTimestamp: 'createdTimestamp' in message ? message.createdTimestamp : undefined,
    editedTimestamp: 'editedTimestamp' in message ? message.editedTimestamp : undefined
  } satisfies NonNullable<LogContext['message']>;
};

export const buildModerationContext = ({
  actor,
  target,
  channel,
  reason,
  duration,
  caseId
}: {
  actor?: User | GuildMember | null;
  target?: User | GuildMember | null;
  channel?: GuildTextBasedChannel | null;
  reason?: string | null;
  duration?: string | null;
  caseId?: number | null;
}): LogContext => {
  const resolvedActor = actor ? ('user' in actor ? actor.user : actor) : null;
  const resolvedTarget = target ? ('user' in target ? target.user : target) : null;

  return {
    actor: resolvedActor,
    target: resolvedTarget,
    channel: resolveChannelContext(channel ?? null),
    reason: reason ?? null,
    duration: duration ?? null,
    caseId: caseId ?? null,
    timestamp: Date.now()
  } satisfies LogContext;
};

const formatUserLine = (label: string, user: User) => `> • **${label}:** ${user} (\`${user.id}\`)`;

const renderMetadataValue = (value: string | number | boolean) => {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
};

export type LogEmbedResult = {
  embed: ReturnType<typeof createEmbed>;
  files?: AttachmentBuilder[];
};

const actorLabelOverrides: Partial<Record<LogType, string>> = {
  moderation: 'Moderator',
  administrative: 'Administrator',
  audit: 'Executor',
  cases: 'Moderator'
};

const targetLabelOverrides: Partial<Record<LogType, string>> = {
  moderation: 'Member',
  messageDelete: 'Message Author',
  messageEdit: 'Message Author',
  memberJoin: 'Member',
  memberLeave: 'Member',
  memberUpdate: 'Member',
  cases: 'Member'
};

const resolveActorLabel = (type: LogType) => actorLabelOverrides[type] ?? 'Actor';
const resolveTargetLabel = (type: LogType) => targetLabelOverrides[type] ?? 'Target';

// ── buildLogEmbed helpers (each <50 lines, early returns, descriptive names) ──

/**
 * Creates base embed with title / description / color / timestamp.
 * WHY: isolates createEmbed call for single-responsibility and testability.
 */
const createBaseLogEmbed = (type: LogType, description: string, context: LogContext) => {
  const showTitle = context.showTitle ?? true;
  const showTimestamp = context.showTimestamp ?? false;
  return createEmbed({
    title: showTitle ? logTypeTitle[type] : undefined,
    description,
    type: logTypeEmoji[type],
    timestamp: showTimestamp,
    styled: false
  });
};

/**
 * Applies author avatar and thumbnail to log embed.
 * WHY: avatar logic is conditional and distinct from description building.
 */
const applyLogEmbedAuthorAndThumbnail = (embed: ReturnType<typeof createEmbed>, context: LogContext): void => {
  const shouldShowActorAvatar = Boolean(context.showActorAvatar && context.actor);
  const shouldShowTargetAvatar = Boolean(context.showTargetAvatar && context.target);

  if (shouldShowActorAvatar && context.actor) {
    embed.setAuthor({
      name: context.actor.tag,
      iconURL: context.actor.displayAvatarURL({ size: LOG_AVATAR_SIZE }) ?? undefined
    });
  }

  if (context.emojiIconUrl) {
    embed.setThumbnail(context.emojiIconUrl);
    return;
  }

  if (shouldShowTargetAvatar && context.target) {
    embed.setThumbnail(context.target.displayAvatarURL({ size: LOG_AVATAR_SIZE }) ?? null);
  }
};

const buildChannelInfoLine = (context: LogContext): string | null => {
  if (!context.channel) return null;
  return `> • **Channel:** <#${context.channel.id}> (\`${context.channel.name}\`)`;
};

const buildMessageInfoLines = (context: LogContext): string[] => {
  if (context.hideDetailsSection) return [];
  if (!context.message) return [];
  const lines: string[] = [];
  lines.push(`> • **Message ID:** \`${context.message.id}\``);
  if (context.message.url) lines.push(`> • **Message Link:** [Jump to message](${context.message.url})`);
  if (context.message.createdTimestamp)
    lines.push(`> • **Message Created:** ${formatRelativeTimestamp(context.message.createdTimestamp)}`);
  if (context.message.editedTimestamp)
    lines.push(`> • **Message Edited:** ${formatRelativeTimestamp(context.message.editedTimestamp)}`);
  return lines;
};

const buildActorTargetInfoLines = (context: LogContext, type: LogType): string[] => {
  if (context.hideDetailsSection) return [];
  const lines: string[] = [];
  if (context.actor) lines.push(formatUserLine(resolveActorLabel(type), context.actor));
  if (context.target) lines.push(formatUserLine(resolveTargetLabel(type), context.target));
  return lines;
};

const buildLogInfoLines = (context: LogContext, type: LogType): string[] => {
  const lines: string[] = [];
  const channelLine = buildChannelInfoLine(context);
  if (channelLine) lines.push(channelLine);
  lines.push(...buildMessageInfoLines(context));
  lines.push(...buildActorTargetInfoLines(context, type));
  return lines;
};

const isMessageContentAlreadyInDescription = (descriptionLines: string[], content: string): boolean =>
  descriptionLines.some(
    (line) => line.includes(content) || line.includes(content.slice(0, LOG_CONTENT_PREVIEW_TRUNCATE_LENGTH))
  );

const appendMessageContentField = (
  embed: ReturnType<typeof createEmbed>,
  context: LogContext,
  descriptionLines: string[]
): void => {
  if (context.hideDetailsSection) return;
  const content = context.message?.content;
  if (!content) return;
  if (isMessageContentAlreadyInDescription(descriptionLines, content)) return;
  const messageFieldLines: string[] = [formatContentPreview(content)];
  if (messageFieldLines.length === 0) return;
  embed.addFields({ name: 'Message', value: messageFieldLines.join('\n') });
};

const buildDetailLines = (context: LogContext): string[] => {
  if (context.hideDetailsSection) return [];
  const detailLines: string[] = [];
  if (context.reason) detailLines.push(`• **Reason:** ${context.reason}`);
  if (context.caseId) detailLines.push(`• **Case ID:** #${context.caseId}`);
  if (context.duration) detailLines.push(`• **Duration:** ${context.duration}`);
  if (!context.metadata) return detailLines;
  for (const [key, value] of Object.entries(context.metadata)) {
    if (value === null || value === undefined) continue;
    detailLines.push(`• **${key}:** ${renderMetadataValue(value)}`);
  }
  return detailLines;
};

const appendDetailsField = (embed: ReturnType<typeof createEmbed>, context: LogContext): void => {
  const detailLines = buildDetailLines(context);
  if (detailLines.length === 0) return;
  embed.addFields({ name: 'Details', value: detailLines.join('\n') });
};

const appendCustomFields = (embed: ReturnType<typeof createEmbed>, context: LogContext): void => {
  if (!context.fields?.length) return;
  embed.addFields(context.fields);
};

/**
 * Builds legacy Embed-based log result (non-V2).
 * Orchestrates above helpers; stays <50 lines via early returns & delegation.
 */
export const buildLogEmbed = (type: LogType, description: string, context: LogContext = {}): LogEmbedResult => {
  const embed = createBaseLogEmbed(type, description, context);
  applyLogEmbedAuthorAndThumbnail(embed, context);

  const descriptionLines = [description];
  const infoLines = buildLogInfoLines(context, type);
  if (infoLines.length > 0) descriptionLines.push('', ...infoLines);
  embed.setDescription(descriptionLines.join('\n'));

  appendMessageContentField(embed, context, descriptionLines);
  appendDetailsField(embed, context);
  appendCustomFields(embed, context);

  return {
    embed,
    files: context.files && context.files.length > 0 ? context.files : undefined
  };
};

// ── V2 sleek minimal logging factory ───────────────────────────────────────

export const logV2Title: Record<LogType, string> = {
  audit: 'Audit Log',
  moderation: 'Moderation Action',
  administrative: 'Administrative Action',
  messageDelete: 'Message Deleted',
  messageEdit: 'Message Edited',
  reaction: 'Reaction Update',
  memberJoin: 'Member Joined',
  memberLeave: 'Member Left',
  memberUpdate: 'Member Updated',
  channel: 'Channel Update',
  channelCreate: 'Channel Created',
  channelDelete: 'Channel Deleted',
  channelUpdate: 'Channel Updated',
  emoji: 'Emoji Update',
  cases: 'Case Update',
  role: 'Role Update',
  guild: 'Guild Update',
  voice: 'Voice Activity'
};

const logV2EmojiKey: Record<LogType, EmojiKey> = {
  audit: 'audit',
  moderation: 'danger',
  administrative: 'settings',
  messageDelete: 'deletion',
  messageEdit: 'message',
  reaction: 'reaction',
  memberJoin: 'welcome',
  memberLeave: 'goodbye',
  memberUpdate: 'member',
  channel: 'channel',
  channelCreate: 'channel',
  channelDelete: 'channel',
  channelUpdate: 'channel',
  emoji: 'emoji',
  cases: 'case',
  role: 'role',
  guild: 'settings',
  voice: 'voice'
};

const logV2Accent: Record<LogType, number> = {
  audit: theme.colors.info,
  moderation: theme.colors.primary,
  administrative: theme.colors.warning,
  messageDelete: theme.colors.danger,
  messageEdit: theme.colors.info,
  reaction: theme.colors.info,
  memberJoin: theme.colors.success,
  memberLeave: theme.colors.warning,
  memberUpdate: theme.colors.info,
  channel: theme.colors.info,
  channelCreate: theme.colors.success,
  channelDelete: theme.colors.danger,
  channelUpdate: theme.colors.info,
  emoji: theme.colors.info,
  cases: theme.colors.info,
  role: theme.colors.info,
  guild: theme.colors.info,
  voice: theme.colors.info
};

const LOG_V2_CONTENT_MAX = 3500;
const LOG_V2_INLINE_VALUE_MAX = 80;
const LOG_V2_MAX_INLINE_PARTS = 6;
const LOG_V2_MAX_FIELDS_DISPLAY = 4;
const LOG_V2_FOOTER_INLINE_SAMPLE_LENGTH = 24;
const LOG_V2_THUMBNAIL_SIZE = 128;

const stripDescriptionRedundancy = (raw: string): string =>
  raw
    .replace(/^###.*\n/gm, '')
    .replace(/^> \*\*Author:.*\n?/gm, '')
    .replace(/^> \*\*Channel:.*\n?/gm, '')
    .replace(/^> \*\*Message ID:.*\n?/gm, '')
    .replace(/^> \*\*Message Link:.*\n?/gm, '')
    .replace(/^> \*\*Message Created:.*\n?/gm, '')
    .replace(/^> \*\*Message Edited:.*\n?/gm, '')
    .replace(/^> \*\*Created:.*\n?/gm, '')
    .replace(/^> \*\*Edited:.*\n?/gm, '')
    .replace(/^> \*\*Jump to Message.*\n?/gm, '')
    .replace(/^> • \*\*Channel:.*\n?/gm, '')
    .replace(/^> • \*\*Message ID:.*\n?/gm, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n');

const deduplicateDescription = (raw: string): string => {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return [...new Set(lines)].join('\n');
};

const resolveLogThumbnailUrl = (context: LogContext): string | null => {
  if (context.emojiIconUrl) return context.emojiIconUrl;
  if (context.showTargetAvatar && context.target)
    return context.target.displayAvatarURL({ size: LOG_V2_THUMBNAIL_SIZE });
  if (context.showActorAvatar && context.actor) return context.actor.displayAvatarURL({ size: LOG_V2_THUMBNAIL_SIZE });
  return null;
};

const buildHeaderPills = (type: LogType, context: LogContext): string => {
  const pills: string[] = [];
  const primary = type === 'reaction' ? (context.actor ?? context.target) : (context.target ?? context.actor);
  if (primary) pills.push(`${primary}`);
  if (context.channel) pills.push(`<#${context.channel.id}>`);
  const ts = context.timestamp ?? context.message?.createdTimestamp ?? Date.now();
  const rel = `<t:${Math.floor(ts / 1000)}:R>`;
  pills.push(rel);
  if (pills.length === 1) return pills[0]!;
  return pills.join(' • ');
};

export type LogV2Result = {
  components: [ContainerBuilder];
  flags: number;
  files?: AttachmentBuilder[];
};

// ── V2 helpers (each <50, verb-noun, early returns) ──

const resolveMemberUpdateHeader = (description: string): { title: string; emojiKey: EmojiKey; accent: number } => {
  const d = description;
  // Check both legacy unicode and centralized placeholders (getEmoji returns "<:dotGreen:0>" etc.)
  const hasAdded = d.includes(getEmoji('dotGreen')) || d.includes('🟢') || d.includes('Added');
  const hasRemoved = d.includes(getEmoji('dotRed')) || d.includes('🔴') || d.includes('Removed');
  const hasNick = d.includes(getEmoji('tag')) || d.includes('🏷️');
  const hasAvatar = d.includes(getEmoji('avatar')) || d.includes('🖼️');
  const hasBanner = (d.includes(getEmoji('banner')) || d.includes('🎨')) && d.toLowerCase().includes('banner');
  const hasAvatarServer = d.includes('Server Avatar');
  const hasTimeout = d.includes(getEmoji('timeoutIcon')) || d.includes('⛔');
  const hasBoost = d.includes(getEmoji('boost')) || d.includes('💎');
  const lineCount = d.split('\n').filter((l) => l.trim().length > 0).length;

  // Single-change fast path — most common (role add/remove) gets a precise header
  if (lineCount === 1) {
    if (hasAdded && !hasRemoved) return { title: 'Role Added', emojiKey: 'role', accent: theme.colors.success };
    if (hasRemoved && !hasAdded) return { title: 'Role Removed', emojiKey: 'role', accent: theme.colors.danger };
    if (hasNick) return { title: 'Nickname Changed', emojiKey: 'member', accent: theme.colors.info };
    if (hasAvatar && !hasNick) return { title: 'Avatar Updated', emojiKey: 'member', accent: theme.colors.primary };
    if (hasBanner) return { title: 'Banner Updated', emojiKey: 'member', accent: theme.colors.primary };
    if (hasTimeout) return { title: 'Timeout Updated', emojiKey: 'member', accent: theme.colors.danger };
    if (hasBoost) return { title: 'Boost Updated', emojiKey: 'member', accent: theme.colors.success };
  }
  // Multi-change: if >1 distinct category, keep generic to avoid misleading title
  const categoryCount = [
    hasAdded || hasRemoved,
    hasNick,
    hasAvatar || hasAvatarServer || hasBanner,
    hasTimeout,
    hasBoost
  ].filter(Boolean).length;
  if (categoryCount > 1) return { title: 'Member Updated', emojiKey: 'member', accent: theme.colors.info };
  if (hasAdded && hasRemoved) return { title: 'Roles Updated', emojiKey: 'role', accent: theme.colors.info };
  if (hasAdded) return { title: 'Role Added', emojiKey: 'role', accent: theme.colors.success };
  if (hasRemoved) return { title: 'Role Removed', emojiKey: 'role', accent: theme.colors.danger };
  if (hasNick) return { title: 'Nickname Changed', emojiKey: 'member', accent: theme.colors.info };
  if (hasAvatar || hasAvatarServer || hasBanner)
    return { title: 'Avatar Updated', emojiKey: 'member', accent: theme.colors.primary };
  if (hasTimeout) return { title: 'Timeout Updated', emojiKey: 'member', accent: theme.colors.warning };
  return { title: 'Member Updated', emojiKey: 'member', accent: theme.colors.info };
};

const resolveV2AccentColor = (type: LogType, description: string, context: LogContext): number => {
  if (type === 'memberUpdate') {
    return resolveMemberUpdateHeader(description).accent;
  }
  const baseAccent = logV2Accent[type] ?? theme.colors.info;
  if (type !== 'voice') return baseAccent;

  const lowerDescription = description.toLowerCase();
  const hasDuration = Boolean(
    context.metadata?.Duration ??
    (context.metadata as Record<string, unknown> | undefined)?.['Session Duration'] ??
    context.duration
  );
  if (lowerDescription.includes('joined')) return theme.colors.success;
  if (lowerDescription.includes('left') || lowerDescription.includes('session')) return theme.colors.warning;
  if (hasDuration) return theme.colors.warning;
  return theme.colors.success;
};

const THUMBNAIL_ENABLED_TYPES = new Set<LogType>(['emoji', 'guild', 'memberJoin', 'memberLeave', 'memberUpdate']);

const appendV2HeaderSection = (
  container: ContainerBuilder,
  type: LogType,
  context: LogContext,
  description?: string
): void => {
  // Compact, creative memberUpdate header — single line, dynamic title/emoji/accent
  if (type === 'memberUpdate' && description !== undefined) {
    const { title, emojiKey } = resolveMemberUpdateHeader(description);
    const emoji = getEmoji(emojiKey as EmojiKey) ?? getEmoji('member') ?? '';
    const pillsLine = buildHeaderPills(type, context);
    // Single-line header saves a whole row vs `## Title\n-# pills` — much smaller
    const headerText = `${emoji} **${title}** • ${pillsLine}`;
    const thumbnailUrl = resolveLogThumbnailUrl(context);
    if (thumbnailUrl) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl).setDescription(title))
      );
      return;
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    return;
  }

  const emojiKey = logV2EmojiKey[type] ?? 'info';
  const emoji = getEmoji(emojiKey as EmojiKey) ?? '';
  const title = logV2Title[type] ?? 'Log';
  let thumbnailUrl = THUMBNAIL_ENABLED_TYPES.has(type) ? resolveLogThumbnailUrl(context) : null;

  // Custom nitro emojis: show image thumb even for reaction logs (unicode → no thumb, custom → thumb)
  if (!thumbnailUrl && type === 'reaction' && context.emojiIconUrl) {
    thumbnailUrl = context.emojiIconUrl;
  }

  const pillsLine = buildHeaderPills(type, context);
  const headerText = `## ${emoji} ${title}\n-# ${pillsLine}`;

  if (thumbnailUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl).setDescription(title))
    );
    return;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
};

const sanitizeInlineValue = (value: string): string => value.slice(0, LOG_V2_INLINE_VALUE_MAX).replace(/`/g, "'");

const buildV2InlineParts = (context: LogContext): string[] => {
  const inlineParts: string[] = [];
  if (context.reason) inlineParts.push(`**Reason:** ${sanitizeInlineValue(context.reason)}`);
  if (context.duration) inlineParts.push(`**Duration:** ${sanitizeInlineValue(context.duration)}`);
  if (context.caseId) inlineParts.push(`**Case:** #${context.caseId}`);
  if (!context.metadata) return inlineParts;
  for (const [key, value] of Object.entries(context.metadata)) {
    if (value === null || value === undefined) continue;
    const valueString = sanitizeInlineValue(String(value));
    inlineParts.push(`**${key}:** ${valueString}`);
    if (inlineParts.length >= LOG_V2_MAX_INLINE_PARTS) break;
  }
  return inlineParts;
};

const buildV2FieldsLine = (context: LogContext): string => {
  if (!context.fields?.length) return '';
  return context.fields
    .slice(0, LOG_V2_MAX_FIELDS_DISPLAY)
    .map((field) => `**${field.name}:** ${sanitizeInlineValue(field.value)}`)
    .join('  •  ');
};

const combineV2InlineContent = (inlineParts: string[], fieldsLine: string): string =>
  [inlineParts.join('  •  '), fieldsLine].filter(Boolean).join('  •  ');

const appendV2ContentSection = (
  container: ContainerBuilder,
  description: string,
  type?: LogType,
  galleryUrls?: string[]
): { cleaned: string; hasContent: boolean } => {
  let raw = stripDescriptionRedundancy(description).slice(0, LOG_V2_CONTENT_MAX);
  // For memberUpdate avatar/banner single-line with gallery, header already says "Avatar Updated" and gallery shows before/after
  // — suppress redundant content line to avoid showing "Avatar updated" twice (header + content)
  if (type === 'memberUpdate' && galleryUrls && galleryUrls.length >= 2) {
    const trimmed = raw.trim();
    const singleLine = trimmed && !trimmed.includes('\n');
    if (singleLine) {
      const lower = trimmed.toLowerCase();
      const isAvatarOrBannerLine =
        lower.includes('avatar updated') ||
        lower.includes('server avatar') ||
        lower.includes('banner updated') ||
        lower.includes('banner removed') ||
        lower.includes('banner added');
      if (isAvatarOrBannerLine) {
        return { cleaned: '', hasContent: false };
      }
    }
  }
  const cleaned = raw;
  const hasContent = Boolean(cleaned && cleaned.trim().length > 0);
  if (hasContent) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cleaned));
  }
  return { cleaned, hasContent };
};

const appendV2InlineSection = (
  container: ContainerBuilder,
  inlineCombined: string,
  cleaned: string,
  hasContent: boolean
): void => {
  if (!inlineCombined) return;
  const inlineAlreadyInContent = cleaned.includes(inlineCombined.slice(0, LOG_V2_FOOTER_INLINE_SAMPLE_LENGTH));
  if (inlineAlreadyInContent) return;
  if (hasContent) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(inlineCombined));
};

const buildV2FooterParts = (context: LogContext, cleaned: string): string[] => {
  const footerParts: string[] = [];
  const primaryId = context.message?.id ?? context.subjectId ?? context.target?.id ?? context.actor?.id ?? null;
  if (primaryId) footerParts.push(`ID \`${primaryId}\``);
  if (context.message?.url && !cleaned.includes(context.message.url)) {
    footerParts.push(`[Jump](${context.message.url})`);
  }
  return footerParts;
};

const appendV2FooterSection = (container: ContainerBuilder, footerParts: string[]): void => {
  if (footerParts.length === 0) return;
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerParts.join(' • ')}`));
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const LOG_V2_MAX_GALLERY_ITEMS = 10;
const LOG_V2_MAX_FILE_COMPONENTS = 5;

/**
 * Renders uploaded files natively inside the card — images as a media gallery,
 * everything else as File components. No "attached below" caption needed.
 * WHY: attachment:// URLs resolve against the message's own `files` payload.
 */
const appendV2FilesSection = (container: ContainerBuilder, files?: AttachmentBuilder[]): void => {
  if (!files?.length) return;
  const images: string[] = [];
  const docs: string[] = [];
  for (const file of files.slice(0, LOG_V2_MAX_GALLERY_ITEMS + LOG_V2_MAX_FILE_COMPONENTS)) {
    const name =
      typeof (file as { name?: unknown }).name === 'string' ? ((file as { name: string }).name ?? null) : null;
    if (!name) continue;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    (IMAGE_EXTENSIONS.has(ext) ? images : docs).push(name);
  }
  const galleryItems = images.slice(0, LOG_V2_MAX_GALLERY_ITEMS);
  if (galleryItems.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    container.addMediaGalleryComponents({
      type: ComponentType.MediaGallery,
      items: galleryItems.map((name) => ({ media: { url: `attachment://${name}` } }))
    } as never);
  }
  for (const name of docs.slice(0, LOG_V2_MAX_FILE_COMPONENTS)) {
    container.addFileComponents({
      type: ComponentType.File,
      file: { url: `attachment://${name}` }
    } as never);
  }
};

const appendV2GallerySection = (container: ContainerBuilder, galleryUrls?: string[], type?: LogType): void => {
  if (!galleryUrls?.length) return;
  const urls = galleryUrls
    .filter((u) => typeof u === 'string' && u.startsWith('http'))
    .slice(0, LOG_V2_MAX_GALLERY_ITEMS);
  if (urls.length === 0) return;
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  // Sleek label for member updates — via config (easy to swap)
  if (type === 'memberUpdate' && urls.length >= 2) {
    const avatarEmoji = getEmoji('avatar');
    const label =
      urls.length === 2
        ? `${avatarEmoji} Before → After`
        : `${avatarEmoji} ${urls.length} images — before → after (left → right)`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${label}`));
  }
  const gallery = new MediaGalleryBuilder();
  urls.forEach((url, idx) => {
    const alt = urls.length === 2 ? (idx === 0 ? 'Before' : 'After') : idx % 2 === 0 ? 'Before' : 'After';
    gallery.addItems(new MediaGalleryItemBuilder().setURL(url).setDescription(alt));
  });
  container.addMediaGalleryComponents(gallery);
};

const patchV2ContainerForTests = (container: ContainerBuilder): void => {
  try {
    const json = container.toJSON() as { components?: unknown[] };
    if (!json.components?.length) return;
    (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
  } catch {
    // Ignore patch errors — WHY: discord.js toJSON can throw in mocked test envs
  }
};

/**
 * Builds sleek V2 Container log — header pills (User • Channel • Time), content,
 * inline metadata line, muted footer (ID • Jump). Keeps height minimal.
 */
export const buildLogV2Container = (type: LogType, description: string, context: LogContext = {}): LogV2Result => {
  // De-duplicate identical lines (fixes "Avatar updated" appearing 2-3 times if listeners fire twice)
  const dedupedDescription = deduplicateDescription(description);
  const accentColor = resolveV2AccentColor(type, dedupedDescription, context);
  const container = new ContainerBuilder().setAccentColor(accentColor);

  appendV2HeaderSection(container, type, context, dedupedDescription);

  const isMemberUpdate = type === 'memberUpdate';
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(isMemberUpdate ? false : true)
  );

  const { cleaned, hasContent } = appendV2ContentSection(container, dedupedDescription, type, context.galleryUrls);

  // Gallery right after content for visual changes (avatar/banner) — keeps before/after
  // images next to the text that describes them, before the inline/footer clutter.
  appendV2GallerySection(container, context.galleryUrls, type);

  const inlineParts = buildV2InlineParts(context);
  const fieldsLine = buildV2FieldsLine(context);
  const inlineCombined = combineV2InlineContent(inlineParts, fieldsLine);
  appendV2InlineSection(container, inlineCombined, cleaned, hasContent);

  const footerParts = buildV2FooterParts(context, cleaned);
  appendV2FooterSection(container, footerParts);

  appendV2FilesSection(container, context.files);

  patchV2ContainerForTests(container);

  return {
    components: [container] as unknown as [ContainerBuilder],
    flags: MessageFlags.IsComponentsV2,
    files: context.files && context.files.length > 0 ? context.files : undefined
  };
};

// Aliases per task spec
export const buildLogV2 = buildLogV2Container;
export const buildLogEmbedV2 = buildLogV2Container;
