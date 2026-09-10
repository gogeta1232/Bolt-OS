import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

import { reactionHandlerService } from '../../lib/reaction-handler/service.js';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionAdd })
export class UnifiedReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
  public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    try {
      // Convert partial types
      if (reaction.partial) reaction = await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
      if (user.partial) await user.fetch();

      // Handle the reaction with unified handler
      await reactionHandlerService.handleReactionAdd(reaction as MessageReaction, user as User);
    } catch (error) {
      this.container.logger.error({ err: error }, 'Error handling unified reaction add');
    }
  }
}
