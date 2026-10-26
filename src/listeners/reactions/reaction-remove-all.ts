import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message, PartialMessage } from 'discord.js';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionRemoveAll })
export class ReactionRemoveAllListener extends Listener<typeof Events.MessageReactionRemoveAll> {
  public async run(message: Message | PartialMessage): Promise<void> {
    try {
      // Fetch the message if it's partial
      if (message.partial) {
        await message.fetch();
      }

      const guild = message.guild;
      if (!guild) return;

      const description = message.author ? `Message by ${message.author}` : 'Message author unavailable';

      await this.container.logging.sendReactionLog(guild, description, {
        activity: 'reactionClear',
        target: message.author ?? null,
        channel: message.channel,
        message: {
          id: message.id,
          url: message.url,
          content: message.content || null
        },
        timestamp: Date.now()
      });
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to log reaction remove all event');
    }
  }
}
