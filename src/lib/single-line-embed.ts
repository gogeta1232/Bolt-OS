/* eslint-disable no-redeclare -- file uses TS overload signatures for precise ephemeral flag types */
import { EmbedBuilder, MessageFlags } from 'discord.js';

import { getEmoji } from '../config/emojis.js';
import { theme } from '../config/theme.js';

export type ToastKind = 'success' | 'warning' | 'danger' | 'info' | 'primary';

type ToastEmbed = EmbedBuilder;
type ToastNoFlags = { embeds: [ToastEmbed] };
type ToastEphemeral = { embeds: [ToastEmbed]; flags: MessageFlags.Ephemeral };

const KIND_EMOJI = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  primary: 'info'
} as const;

/**
 * Single-line toast payload — one emoji + one line of text, colored bar.
 * Single source of truth for all outcome toasts (banned, warned, kicked...).
 * Overloads keep types precise: literal `true` → flags (interaction replies only),
 * literal `false`/omitted → embeds only (safe for channel/message sends).
 */
export function toast(kind: ToastKind, message: string, ephemeral: true): ToastEphemeral;
export function toast(kind: ToastKind, message: string, ephemeral?: false): ToastNoFlags;
export function toast(kind: ToastKind, message: string, ephemeral?: boolean): ToastNoFlags | ToastEphemeral;
export function toast(kind: ToastKind, message: string, ephemeral = false): ToastNoFlags | ToastEphemeral {
  const emoji = getEmoji(KIND_EMOJI[kind]);
  const embed = new EmbedBuilder()
    .setDescription(`${emoji} | ${message}`)
    .setColor(theme.colors[kind] ?? theme.colors.info);

  if (ephemeral) return { embeds: [embed], flags: MessageFlags.Ephemeral };
  return { embeds: [embed] };
}

interface LegacyToastOptions {
  emojiKey?: string;
  message: string;
  ephemeral?: boolean;
}

/** Legacy object-arg form — kept so existing imports don't break. */
export function createSingleLineEmbed(options: LegacyToastOptions & { ephemeral: true }): ToastEphemeral;
export function createSingleLineEmbed(options: LegacyToastOptions & { ephemeral?: false }): ToastNoFlags;
export function createSingleLineEmbed({
  emojiKey,
  message,
  ephemeral = false
}: LegacyToastOptions): ToastNoFlags | ToastEphemeral {
  const emoji = emojiKey ? getEmoji(emojiKey as never) : getEmoji('info');
  const embed = new EmbedBuilder().setDescription(`${emoji} | ${message}`).setColor(theme.colors.info);

  if (ephemeral) return { embeds: [embed], flags: MessageFlags.Ephemeral };
  return { embeds: [embed] };
}

export function createSuccessEmbed(message: string, ephemeral: true): ToastEphemeral;
export function createSuccessEmbed(message: string, ephemeral?: false): ToastNoFlags;
export function createSuccessEmbed(message: string, ephemeral?: boolean): ToastNoFlags | ToastEphemeral;
export function createSuccessEmbed(message: string, ephemeral = false): ToastNoFlags | ToastEphemeral {
  return ephemeral ? toast('success', message, true) : toast('success', message);
}

export function createWarningEmbed(message: string, ephemeral: true): ToastEphemeral;
export function createWarningEmbed(message: string, ephemeral?: false): ToastNoFlags;
export function createWarningEmbed(message: string, ephemeral?: boolean): ToastNoFlags | ToastEphemeral;
export function createWarningEmbed(message: string, ephemeral = false): ToastNoFlags | ToastEphemeral {
  return ephemeral ? toast('warning', message, true) : toast('warning', message);
}

export function createDangerEmbed(message: string, ephemeral: true): ToastEphemeral;
export function createDangerEmbed(message: string, ephemeral?: false): ToastNoFlags;
export function createDangerEmbed(message: string, ephemeral?: boolean): ToastNoFlags | ToastEphemeral;
export function createDangerEmbed(message: string, ephemeral = false): ToastNoFlags | ToastEphemeral {
  return ephemeral ? toast('danger', message, true) : toast('danger', message);
}

export function createInfoEmbed(message: string, ephemeral: true): ToastEphemeral;
export function createInfoEmbed(message: string, ephemeral?: false): ToastNoFlags;
export function createInfoEmbed(message: string, ephemeral?: boolean): ToastNoFlags | ToastEphemeral;
export function createInfoEmbed(message: string, ephemeral = false): ToastNoFlags | ToastEphemeral {
  return ephemeral ? toast('info', message, true) : toast('info', message);
}
