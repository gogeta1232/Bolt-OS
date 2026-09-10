import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';

import { theme } from '../config/theme.js';
import { getEmoji, type EmojiKey } from '../config/emojis.js';
import type { CaseAction, CaseDocument } from '../database/models/moderation/Case.js';

// ── Constants — charcoal #20211B from theme ──
export const CASE_ACCENT = 0x20211b;

const ACTION_EMOJI: Record<CaseAction, EmojiKey> = {
  ban: 'ban',
  softban: 'ban',
  kick: 'kick',
  mute: 'mute',
  timeout: 'timeout',
  warn: 'warning',
  unban: 'ban',
  unmute: 'mute',
  role: 'role',
  note: 'document',
  jail: 'jail',
  unjail: 'jail'
};

const ACTION_ACCENT: Record<CaseAction, number> = {
  ban: theme.colors.danger,
  softban: theme.colors.danger,
  kick: theme.colors.danger,
  mute: theme.colors.warning,
  timeout: theme.colors.warning,
  warn: theme.colors.warning,
  unban: theme.colors.success,
  unmute: theme.colors.success,
  role: theme.colors.primary,
  note: theme.colors.info,
  jail: theme.colors.danger,
  unjail: theme.colors.success
};

// ── Helpers ──
const titleCase = (action: string): string => action.charAt(0).toUpperCase() + action.slice(1);

const resolveActionEmoji = (action: CaseAction): string => {
  const key = ACTION_EMOJI[action] ?? 'case';
  return getEmoji(key as EmojiKey) || getEmoji('case') || '•';
};

const resolveActionAccent = (action: CaseAction): number => ACTION_ACCENT[action] ?? CASE_ACCENT;

const truncate = (value: string, max = 90): string => {
  const sanitized = value.replace(/`/g, "'").replace(/\n/g, ' ').trim();
  if (sanitized.length <= max) return sanitized;
  return `${sanitized.slice(0, max - 1)}…`;
};

const formatReason = (reason: string): string => {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.toLowerCase() === 'no reason provided') {
    return '*No reason provided*';
  }
  return `*${truncate(trimmed, 96)}*`;
};

const formatTimestamp = (date: Date): string => `<t:${Math.floor(date.getTime() / 1000)}:R>`;

const divider = (visible: boolean): SeparatorBuilder =>
  new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(visible);

const patchContainer = (container: ContainerBuilder): ContainerBuilder => {
  try {
    const json = container.toJSON() as { components?: unknown[] };
    if (json.components?.length) {
      (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
    }
  } catch {
    void 0;
  }
  return container;
};

// ── Per-case entry (airy two-line card) ──
export const formatCaseEntry = (entry: CaseDocument): string => {
  const emoji = resolveActionEmoji(entry.action);
  const idBadge = `\` #${entry.caseId} \``;
  const actionLabel = `**${titleCase(entry.action)}**`;
  const target = `\`${entry.targetTag}\``;
  const line1 = `${idBadge}  ${emoji} │ ${actionLabel}  —  ${target}`;

  const reasonPart = formatReason(entry.reason);
  const timePart = formatTimestamp(new Date(entry.createdAt));
  const modPart = `by \`${entry.moderatorTag}\``;
  const extras: string[] = [];
  if (entry.evidence?.length) extras.push(`${getEmoji('paperclip')} ${entry.evidence.length}`);
  if (entry.expiresAt) extras.push(`expires ${formatTimestamp(new Date(entry.expiresAt))}`);
  const extraPart = extras.length ? ` · ${extras.join(' · ')}` : '';
  const line2 = `-# ${reasonPart} · ${timePart} • ${modPart}${extraPart}`;

  return `${line1}\n${line2}`;
};

// ── List container (breathing but dense) ──
export interface BuildCasesListOptions {
  entries: CaseDocument[];
  page: number;
  totalPages: number;
  totalCount: number;
  title: string;
  subtitle?: string;
  guildName?: string;
  guildIconUrl?: string | null;
  accentColor?: number;
}

export const buildCasesListContainer = (options: BuildCasesListOptions): ContainerBuilder => {
  const accent = options.accentColor ?? CASE_ACCENT;
  const container = new ContainerBuilder().setAccentColor(accent);

  const headerEmoji = getEmoji('case') || getEmoji('clipboard');
  const guildPart = options.guildName ? ` · ${options.guildName}` : '';
  const sub =
    options.subtitle ??
    `${options.totalCount.toLocaleString()} total · Page ${options.page + 1}/${options.totalPages}${guildPart}`;
  const headerText = `**${headerEmoji} │ ${options.title}**\n-# ${sub}`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));

  container.addSeparatorComponents(divider(true));

  if (options.entries.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# No cases to display on this page.`));
  } else {
    const joined = options.entries.map((e) => formatCaseEntry(e)).join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(joined));
  }

  container.addSeparatorComponents(divider(false));

  const now = Math.floor(Date.now() / 1000);
  const footer = `-# Page ${options.page + 1}/${options.totalPages} · ${options.entries.length} shown · ${options.totalCount.toLocaleString()} total · <t:${now}:R> · \`/cases view #ID\``;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  return patchContainer(container);
};

// ── Detail container (single case) — no repeating header/body ──
export const buildCaseDetailContainer = (
  entry: CaseDocument,
  _guild?: { name?: string; iconURL?: string | null } | null
): ContainerBuilder => {
  const accent = resolveActionAccent(entry.action);
  const container = new ContainerBuilder().setAccentColor(accent);
  const emoji = resolveActionEmoji(entry.action);

  const created = new Date(entry.createdAt);
  const headerTitle = `**${emoji} │ Case #${entry.caseId} · ${titleCase(entry.action)}**`;
  const headerSub = `-# ${entry.targetTag} · by \`${entry.moderatorTag}\` · ${formatTimestamp(created)}`;
  const headerText = `${headerTitle}\n${headerSub}`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  container.addSeparatorComponents(divider(true));

  void _guild;
  const reasonVal = formatReason(entry.reason);
  const displayReason = reasonVal === '*No reason provided*' ? '*No reason provided*' : reasonVal;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(displayReason));

  // Evidence as native gallery — unlimited, viewable a year later via Discord CDN URLs stored in case
  if (entry.evidence?.length) {
    const imageUrls = entry.evidence.filter((u) => typeof u === 'string' && u.startsWith('http')).slice(0, 10);
    if (imageUrls.length) {
      container.addSeparatorComponents(divider(false));
      const gallery = new MediaGalleryBuilder();
      for (const url of imageUrls)
        gallery.addItems(new MediaGalleryItemBuilder().setURL(url).setDescription('evidence'));
      container.addMediaGalleryComponents(gallery);
    } else {
      container.addSeparatorComponents(divider(false));
      const evLinks = entry.evidence.map((url, i) => `[Evidence ${i + 1}](${url})`).join(' · ');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${getEmoji('paperclip')} ${evLinks}`));
    }
  }

  if (entry.expiresAt) {
    container.addSeparatorComponents(divider(false));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Expires ${formatTimestamp(new Date(entry.expiresAt))}`)
    );
  }

  return patchContainer(container);
};

// ── Navigation rows ──
export const buildCasesNavRowCollector = (
  sessionId: string,
  page: number,
  totalPages: number,
  disabled = false
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${sessionId}:prev`)
      .setLabel('‹')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    new ButtonBuilder()
      .setCustomId(`${sessionId}:stop`)
      .setLabel('×')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${sessionId}:next`)
      .setLabel('›')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1)
  );

export const buildCasesNavRowHandler = (
  page: number,
  totalPages: number,
  requesterId: string,
  mode: string,
  targetId: string,
  limit: number,
  disabled = false
): ActionRowBuilder<ButtonBuilder> => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`case:prev:${page}:${requesterId}:${mode}:${targetId}:${limit}`)
      .setLabel('‹')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    new ButtonBuilder()
      .setCustomId(`case:close:${page}:${requesterId}:${mode}:${targetId}:${limit}`)
      .setLabel('×')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`case:next:${page}:${requesterId}:${mode}:${targetId}:${limit}`)
      .setLabel('›')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1)
  );
  if (disabled) {
    for (const btn of row.components) btn.setDisabled(true);
  }
  return row;
};

export const CASE_COMPONENTS_FLAGS = MessageFlags.IsComponentsV2;
