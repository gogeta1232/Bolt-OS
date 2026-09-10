import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message, PartialMessage } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionRemoveAll })
export class ReactionRemoveAllListener extends Listener<typeof Events.MessageReactionRemoveAll> {
  public async run(message: Message | PartialMessage) {
    try {
      // Fetch the message if it's partial
      if (message.partial) {
        await message.fetch();
      }

      const guild = message.guild;
      if (!guild) return;

      const description = `${getEmoji('reactionRemove')} All reactions removed from message by ${message.author?.toString() || 'a user'}`;

      await this.container.logging.sendReactionLog(guild, description, {
        actor: message.author ?? null,
        target: null,
        channel: message.channel,
        message: {
          id: message.id,
          url: message.url,
          content: message.content || null
        },
        timestamp: Date.now(),
        showActorAvatar: true,
        showTargetAvatar: false,
        emojiIconUrl: null,
        metadata: {
          'Reactions Removed': 'All'
        },
        hideDetailsSection: true
      });
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to log reaction remove all event');
    }
  }
}
