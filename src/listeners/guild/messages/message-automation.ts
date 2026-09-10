import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';

import { createEmbed } from '../../../config/theme.js';

export class MessageAutomationListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate });
  }

  public async run(message: Message) {
    if (message.author.bot || message.author.id === this.container.client.user?.id || !message.guild) return;

    const responders = await this.container.autoResponders.list(message.guild.id);
    if (responders.length === 0) return; // Early exit if no responders configured

    const content = message.content.trim();
    const match = responders.find((responder) =>
      responder.caseSensitive
        ? content === responder.trigger
        : content.toLowerCase() === responder.trigger.toLowerCase()
    );

    if (!match) return;

    this.container.logger.debug(
      { guildId: message.guild.id, channelId: message.channelId, userId: message.author.id, trigger: match.trigger },
      'Autoresponder triggered'
    );

    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    try {
      if (match.useEmbed) {
        await channel.send({
          embeds: [createEmbed({ description: match.response, type: 'primary', styled: false })],
          allowedMentions: { parse: [] }
        });
      } else {
        await channel.send({ content: match.response, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to send autoresponder message');
    }
  }
}
