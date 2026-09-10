import { container } from '@sapphire/framework';

import { env } from '../../config/env.js';
import { GuildConfigModel, type GuildConfigDocument } from '../../database/models/guild/GuildConfig.js';

const CONFIG_CACHE_TTL_MS = 5 * 60_000;
const CONFIG_CACHE_MAX_ENTRIES = 10_000;

const defaultConfig = (guildId: string): GuildConfigDocument => ({
  guildId,
  prefix: env.DEFAULT_PREFIX,
  noPrefixMode: false,
  logChannels: {},
  adminRoleIds: []
});

class ConfigService {
  private readonly cache = new Map<string, { expiresAt: number; value: GuildConfigDocument }>();
  private readonly inFlight = new Map<string, Promise<GuildConfigDocument>>();

  public async fetch(guildId: string): Promise<GuildConfigDocument> {
    const cached = this.cache.get(guildId);
    if (cached?.expiresAt && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = this.inFlight.get(guildId);
    if (pending) return pending;

    const fetchPromise = this.fetchFromDatabase(guildId).finally(() => this.inFlight.delete(guildId));
    this.inFlight.set(guildId, fetchPromise);
    return fetchPromise;
  }

  public async set(guildId: string, data: Partial<GuildConfigDocument>): Promise<GuildConfigDocument> {
    const safeData = { ...data };
    delete safeData.guildId;
    const updated = await GuildConfigModel.findOneAndUpdate(
      { guildId },
      {
        $set: safeData,
        $setOnInsert: {
          guildId,
          ...(safeData.prefix === undefined ? { prefix: env.DEFAULT_PREFIX } : {})
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    )
      .lean()
      .exec();

    const normalized = this.normalize(updated, guildId);
    this.remember(guildId, normalized);
    return normalized;
  }

  public deleteFromCache(guildId: string): void {
    this.cache.delete(guildId);
  }

  private async fetchFromDatabase(guildId: string): Promise<GuildConfigDocument> {
    try {
      const config = await GuildConfigModel.findOneAndUpdate(
        { guildId },
        { $setOnInsert: defaultConfig(guildId) },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      )
        .lean()
        .exec();
      const normalized = this.normalize(config, guildId);
      this.remember(guildId, normalized);
      return normalized;
    } catch (error) {
      const stale = this.cache.get(guildId)?.value;
      if (stale) {
        container.logger.warn({ err: error, guildId }, 'Config lookup failed; using stale cache');
        return stale;
      }

      container.logger.error({ err: error, guildId }, 'Config lookup failed; using safe defaults');
      return defaultConfig(guildId);
    }
  }

  private normalize(input: GuildConfigDocument | null, guildId: string): GuildConfigDocument {
    if (!input) return defaultConfig(guildId);
    return {
      ...input,
      noPrefixMode: input.noPrefixMode ?? false,
      logChannels: input.logChannels ?? {},
      adminRoleIds: input.adminRoleIds ?? []
    };
  }

  private remember(guildId: string, value: GuildConfigDocument): void {
    if (!this.cache.has(guildId) && this.cache.size >= CONFIG_CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }

    this.cache.delete(guildId);
    this.cache.set(guildId, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  }
}

export const configService = new ConfigService();
