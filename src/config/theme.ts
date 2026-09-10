import { EmbedBuilder } from 'discord.js';

import { formatEmbedMessage, type FormatEmbedMessageOptions } from '../lib/embed-format.js';
import type { EmojiKey } from './emojis.js';

export const theme = {
  colors: {
    primary: 0xff482c, // Orange/Red #FF482C
    success: 0xf7b626, // Golden Yellow #F7B626
    warning: 0xf7b626, // Golden Yellow #F7B626
    danger: 0xff482c, // Orange/Red #FF482C
    info: 0x20211b, // Charcoal Black #20211B
    charcoal: 0x20211b,
    accent: 0xff482c
  }
} as const;

type ThemeColorKey = keyof typeof theme.colors;

interface EmbedOptions {
  title?: string;
  description: string;
  type?: ThemeColorKey;
  footer?: string;
  timestamp?: boolean;
  styled?: boolean;
  heading?: string;
  emojiKey?: EmojiKey;
  bullets?: string[];
  toneOverride?: FormatEmbedMessageOptions['tone'];
}

export const createEmbed = ({
  title,
  description,
  type = 'primary',
  footer,
  timestamp = false,
  styled = true,
  heading,
  emojiKey,
  bullets,
  toneOverride
}: EmbedOptions) => {
  const tone =
    toneOverride ??
    (['primary', 'info', 'success', 'warning', 'danger'].includes(type)
      ? (type as FormatEmbedMessageOptions['tone'])
      : 'info');

  const formattedDescription = styled
    ? formatEmbedMessage({ tone, title: heading, emoji: emojiKey, body: description, bullets })
    : description;

  const embed = new EmbedBuilder().setColor(theme.colors[type]).setDescription(formattedDescription);

  if (timestamp) {
    embed.setTimestamp();
  }

  if (title) {
    embed.setTitle(title);
  }

  if (footer) {
    embed.setFooter({ text: footer });
  }

  return embed;
};
