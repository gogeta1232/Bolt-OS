import { getEmoji, type EmojiKey } from '../config/emojis.js';

type EmbedTone = 'primary' | 'info' | 'success' | 'warning' | 'danger';

const toneDefaults: Record<EmbedTone, { emoji: EmojiKey; title: string }> = {
  primary: { emoji: 'log', title: 'Notice' },
  info: { emoji: 'info', title: 'Information' },
  success: { emoji: 'success', title: 'Success' },
  warning: { emoji: 'warning', title: 'Heads up' },
  danger: { emoji: 'danger', title: 'Action required' }
};

const normalizeBody = (body: string) =>
  body
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export interface FormatEmbedMessageOptions {
  tone?: EmbedTone;
  title?: string;
  emoji?: EmojiKey;
  body?: string | null;
  bullets?: string[];
  footer?: string | null;
}

export const formatEmbedMessage = ({
  tone = 'info',
  title,
  emoji,
  body,
  bullets,
  footer
}: FormatEmbedMessageOptions) => {
  const defaults = toneDefaults[tone];
  const headerEmoji = getEmoji(emoji ?? defaults.emoji);
  const heading = title ?? defaults.title;
  const lines: string[] = [`${headerEmoji} **${heading}**`];

  if (body && body.trim().length > 0) {
    lines.push('', ...normalizeBody(body));
  }

  if (bullets && bullets.length > 0) {
    lines.push('');
    lines.push(...bullets.map((line) => `• ${line}`));
  }

  if (footer && footer.trim().length > 0) {
    lines.push('', `*${footer.trim()}*`);
  }

  return lines.join('\n');
};
