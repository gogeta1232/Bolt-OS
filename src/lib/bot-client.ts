import { container, type SapphireClientOptions, type SapphirePrefixHook, SapphireClient } from '@sapphire/framework';
import type { ClientOptions } from 'discord.js';

type BotClientOptions = (SapphireClientOptions & ClientOptions) & {
  tasks?: unknown;
  loadScheduledTaskErrorListeners?: boolean;
};

export class BotClient extends SapphireClient {
  public constructor(options: BotClientOptions) {
    super(options);
    this.on('guildDelete', (guild) => {
      container.config.deleteFromCache(guild.id);
      container.autoResponders.invalidateGuild(guild.id);
      container.logging.invalidateGuild(guild.id);
    });
  }

  public override fetchPrefix: SapphirePrefixHook = (message) => {
    const fallback = this.resolveDefaultPrefix();
    if (!message.guild) return fallback;

    const cached = container.config.getCached(message.guild.id);
    return cached ? cached.prefix?.trim() || fallback : this.resolveGuildPrefix(message.guild.id, fallback);
  };

  public async getGuildPrefix(guildId: string | null): Promise<string> {
    const fallback = this.resolveDefaultPrefix();
    if (!guildId) return fallback;

    return this.resolveGuildPrefix(guildId, fallback);
  }

  private async resolveGuildPrefix(guildId: string, fallback: string): Promise<string> {
    try {
      const config = await container.config.fetch(guildId);
      return config.prefix?.trim() || fallback;
    } catch (error) {
      container.logger.error({ err: error, guildId }, 'Failed to resolve guild prefix, using fallback');
      return fallback;
    }
  }

  private resolveDefaultPrefix(): string {
    const defaultPrefix = this.options.defaultPrefix;
    if (!defaultPrefix) return '!';
    if (typeof defaultPrefix === 'string') return defaultPrefix;
    return defaultPrefix[0] ?? '!';
  }
}
