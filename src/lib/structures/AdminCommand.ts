import { Command, Identifiers, UserError } from '@sapphire/framework';
import type { ChatInputCommandInteraction, Message } from 'discord.js';

import { isAdmin } from '../permissions.js';

export abstract class AdminCommand extends Command {
  protected async ensureAdmin(source: ChatInputCommandInteraction | Message) {
    if (!(await isAdmin(source))) {
      throw new UserError({
        identifier: Identifiers.PreconditionUserPermissions,
        message: 'Administrator permissions required.'
      });
    }
  }
}
