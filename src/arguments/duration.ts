import { Argument } from '@sapphire/framework';

import { parseDuration } from '../lib/utils/duration-parser.js';

export class DurationArgument extends Argument<number> {
  public async run(parameter: string, context: Argument.Context): Promise<Argument.Result<number>> {
    const parsed = parseDuration(parameter);
    if (!parsed) {
      return this.error({
        parameter,
        identifier: 'Duration invalid',
        message: `Invalid duration "${parameter}". Try "5m", "1h", "2 days".`,
        context
      });
    }
    return this.ok(parsed.milliseconds);
  }
}

declare module '@sapphire/framework' {
  interface ArgType {
    duration: number;
  }
}
