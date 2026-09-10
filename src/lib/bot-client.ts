import { container, type SapphireClientOptions, type SapphirePrefixHook, SapphireClient } from '@sapphire/framework';
import type { ClientOptions } from 'discord.js';

type BotClientOptions = (SapphireClientOptions & ClientOptions) & {
  tasks?: unknown;
  loadScheduledTaskErrorListeners?: boolean;
};

export class BotClient extends SapphireClient {
  private readonly prefixCache = new Map<string, string>();

  public constructor(options: BotClientOptions) {
    super(options);
    this.on('guildDelete', (guild) => {
      this.prefixCache.delete(guild.id);
      container.config.deleteFromCache(guild.id);
    });
  }

  public override fetchPrefix: SapphirePrefixHook = async (message) => {
    const fallback = this.resolveDefaultPrefix();
    if (!message.guild) return fallback;

    return this.resolveGuildPrefix(message.guild.id, fallback);
  };

  public async getGuildPrefix(guildId: string | null): Promise<string> {
    const fallback = this.resolveDefaultPrefix();
    if (!guildId) return fallback;

    return this.resolveGuildPrefix(guildId, fallback);
  }

  public updateGuildPrefix(guildId: string, prefix: string | null) {
    const fallback = this.resolveDefaultPrefix();
    const trimmed = prefix?.trim();
    if (trimmed && trimmed.length > 0) {
      this.prefixCache.set(guildId, trimmed);
      return;
    }

    this.prefixCache.set(guildId, fallback);
  }

  private async resolveGuildPrefix(guildId: string, fallback: string): Promise<string> {
    const cached = this.prefixCache.get(guildId);
    if (cached) return cached;

    try {
      const config = await container.config.fetch(guildId);
      const configured = config.prefix?.trim();
      if (configured && configured.length > 0) {
        this.prefixCache.set(guildId, configured);
        return configured;
      }

      this.prefixCache.set(guildId, fallback);
      return fallback;
    } catch (error) {
      container.logger.error({ err: error, guildId }, 'Failed to resolve guild prefix, using fallback');
      return this.prefixCache.get(guildId) ?? fallback;
    }
  }

  private resolveDefaultPrefix(): string {
    const defaultPrefix = this.options.defaultPrefix;
    if (!defaultPrefix) return '!';
    if (typeof defaultPrefix === 'string') return defaultPrefix;
    return defaultPrefix[0] ?? '!';
  }
}
