import { Events, Listener } from '@sapphire/framework';
import type { GuildEmoji } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class EmojiDeleteListener extends Listener<typeof Events.GuildEmojiDelete> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildEmojiDelete });
  }

  public async run(emoji: GuildEmoji) {
    const emojiUrl = emoji.imageURL({
      extension: emoji.animated ? 'gif' : 'png',
      size: 256
    });
    const emojiDisplay = emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;

    const description = [
      `### ${getEmoji('deletion')} Emoji Deleted`,
      `> **Name:** \`:${emoji.name ?? 'unknown'}:\``,
      `> **Preview:** ${emojiDisplay}`,
      `> **Type:** ${emoji.animated ? 'Animated (GIF)' : 'Static (PNG)'}`,
      `> **ID:** \`${emoji.id}\``
    ].join('\n');

    await this.container.logging.sendEmojiLog(emoji.guild, description, {
      emojiIconUrl: emojiUrl,
      timestamp: Date.now(),
      showTitle: false
    });
  }
}
