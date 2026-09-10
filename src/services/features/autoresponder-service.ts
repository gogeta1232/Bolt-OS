import { AutoResponderModel, type AutoResponderDocument } from '../../database/models/features/AutoResponder.js';

class AutoResponderService {
  private readonly cache = new Map<string, { expiresAt: number; value: AutoResponderDocument[] }>();
  private readonly ttlMs = 60_000;
  private readonly maxCachedGuilds = 1_000;

  public async list(guildId: string) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const docs = await AutoResponderModel.find({ guildId }).lean().exec();
    this.remember(guildId, docs);
    return docs;
  }

  public async add(entry: AutoResponderDocument) {
    await AutoResponderModel.create(entry);
    this.cache.delete(entry.guildId);
  }

  public async remove(guildId: string, trigger: string) {
    await AutoResponderModel.deleteOne({ guildId, trigger }).exec();
    this.cache.delete(guildId);
  }

  private remember(guildId: string, value: AutoResponderDocument[]) {
    if (!this.cache.has(guildId) && this.cache.size >= this.maxCachedGuilds) {
      const oldestGuildId = this.cache.keys().next().value as string | undefined;
      if (oldestGuildId) this.cache.delete(oldestGuildId);
    }
    this.cache.set(guildId, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export const autoResponderService = new AutoResponderService();
