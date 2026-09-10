import { Events, Listener } from '@sapphire/framework';
import { container } from '@sapphire/pieces';

import { botConfig } from '../../config/bot.js';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.ClientReady, once: true });
  }

  public async run(): Promise<void> {
    const { client, logger } = container;

    try {
      container.reactionHandlerService.initialize();
      logger.info('Reaction handler service initialized');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize reaction handler');
    }

    try {
      container.snipe.initialize();
      logger.info('Snipe service initialized');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize snipe service');
    }

    container.cases.initialize();

    logger.info({ tag: client.user?.tag, id: client.user?.id }, 'Bot ready');
    await client.user?.setPresence(botConfig.presence);
  }
}
