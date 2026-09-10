import { Events, Listener } from '@sapphire/framework';
import type { GuildEmoji } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

export class EmojiUpdateListener extends Listener<typeof Events.GuildEmojiUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildEmojiUpdate });
  }

  public async run(oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
    const changes: string[] = [];

    if (oldEmoji.name !== newEmoji.name) {
      changes.push(`> • **Name:** \`:${oldEmoji.name ?? 'unknown'}:\` → \`:${newEmoji.name ?? 'unknown'}:\``);
    }

    // If no changes detected, don't send a log
    if (changes.length === 0) return;

    const emojiUrl = newEmoji.imageURL({
      extension: newEmoji.animated ? 'gif' : 'png',
      size: 256
    });
    const emojiDisplay = newEmoji.animated
      ? `<a:${newEmoji.name}:${newEmoji.id}>`
      : `<:${newEmoji.name}:${newEmoji.id}>`;

    const description = [
      `### ${getEmoji('emoji')} Emoji Updated`,
      `> **Preview:** ${emojiDisplay}`,
      `> **Type:** ${newEmoji.animated ? 'Animated (GIF)' : 'Static (PNG)'}`,
      `> **ID:** \`${newEmoji.id}\``,
      ``,
      `**Changes:**`,
      ...changes
    ].join('\n');

    await this.container.logging.sendEmojiLog(newEmoji.guild, description, {
      emojiIconUrl: emojiUrl,
      timestamp: Date.now(),
      showTitle: false
    });
  }
}
