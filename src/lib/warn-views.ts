import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';

import { theme } from '../config/theme.js';
import { getEmoji } from '../config/emojis.js';

export const WARN_REASON_MAX_LENGTH = 1000;
export const WARN_USERNAME_MAX_LENGTH = 32;
export const WARN_EVIDENCE_MAX_LENGTH = 4000;

export interface WarnConfirmationOptions {
  caseId: number;
  username: string;
  userId: string;
  durationLabel?: string | null;
  expiresAt?: Date | number | null;
  reason: string;
  evidence?: string[];
}

/**
 * Formats duration with Discord timestamp markdown — e.g. `1 minute · <t:123:R>`.
 * WHY: plain "1 minute" looks flat; relative timestamps render as cool "in 1 minute".
 */
export const formatWarnDuration = (durationLabel?: string | null, expiresAt?: Date | number | null): string => {
  const label = durationLabel?.trim() ? durationLabel.trim() : null;
  if (!label) return 'Permanent';
  if (!expiresAt) return label;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
  if (!Number.isFinite(ms)) return label;
  const unix = Math.floor(ms / 1000);
  return `${label} · <t:${unix}:R>`;
};

export const formatWarnEvidence = (evidence: readonly string[]): string | null => {
  if (evidence.length === 0) return null;
  const prefix = `${getEmoji('evidence')} `;
  const joined = evidence.join(', ');
  const availableLength = WARN_EVIDENCE_MAX_LENGTH - prefix.length;
  if (joined.length <= availableLength) return `${prefix}${joined}`;
  return `${prefix}${joined.slice(0, Math.max(0, availableLength - 1)).trimEnd()}…`;
};

/**
 * Builds the ultra-minimal warn confirmation — small header, plain username, ID footer.
 * WHY pure helper: no guild line, no avatar, no Member/Moderator mentions, no ping, no repeated case.
 */
export const buildWarnConfirmationContainer = (options: WarnConfirmationOptions): ContainerBuilder => {
  const durationText = formatWarnDuration(options.durationLabel, options.expiresAt);
  const username = options.username.replace(/`/g, "'").slice(0, WARN_USERNAME_MAX_LENGTH).trim() || 'Unknown';
  const reason = options.reason.slice(0, WARN_REASON_MAX_LENGTH).trim() || 'No reason provided';
  const container = new ContainerBuilder().setAccentColor(theme.colors.warning);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**${getEmoji('warning')} Warning · Case #${options.caseId} · ${durationText}**`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(reason));

  const evidenceText = formatWarnEvidence(options.evidence ?? []);
  if (evidenceText) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(evidenceText));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${username} · ID \`${options.userId}\``));

  return container;
};
