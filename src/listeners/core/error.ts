import { Events, Listener } from '@sapphire/framework';

export class ErrorListener extends Listener<typeof Events.Error> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.Error });
  }

  public run(error: Error) {
    this.container.logger.error({ err: error }, 'Unhandled Sapphire error event');
  }
}
