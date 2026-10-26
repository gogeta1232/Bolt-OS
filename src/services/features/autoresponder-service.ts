import { randomUUID } from 'node:crypto';

import { AutoResponderModel, type AutoResponderDocument } from '../../database/models/features/AutoResponder.js';

interface PendingOverwrite {
  previous: AutoResponderDocument;
  proposed: AutoResponderDocument;
  expiresAt: number;
}

export class AutoResponderService {
  private readonly overwrites = new Map<string, PendingOverwrite>();
  private readonly cache = new Map<string, { expiresAt: number; value: AutoResponderDocument[] }>();
  private readonly inFlight = new Map<string, Promise<AutoResponderDocument[]>>();
  private readonly ttlMs = 60_000;
  private readonly maxCachedGuilds = 1_000;

  public async list(guildId: string): Promise<AutoResponderDocument[]> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const pending = this.inFlight.get(guildId);
    if (pending) return pending;
    const request = AutoResponderModel.find({ guildId })
      .lean()
      .exec()
      .then((docs) => {
        // A write or guild removal may invalidate this read before it completes.
        if (this.inFlight.get(guildId) === request) this.remember(guildId, docs);
        return docs;
      })
      .finally(() => {
        if (this.inFlight.get(guildId) === request) this.inFlight.delete(guildId);
      });
    if (this.inFlight.size < this.maxCachedGuilds) this.inFlight.set(guildId, request);
    return request;
  }

  public async add(entry: AutoResponderDocument): Promise<'added' | 'exists'> {
    try {
      await AutoResponderModel.create(entry);
    } catch (error) {
      // The unique guild/trigger index also protects concurrent add requests.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        return 'exists';
      }
      throw error;
    }
    this.invalidateGuild(entry.guildId);
    return 'added';
  }

  public async remove(guildId: string, trigger: string): Promise<void> {
    await AutoResponderModel.deleteOne({ guildId, trigger }).exec();
    this.invalidateGuild(guildId);
  }

  public async prepareOverwrite(
    entry: AutoResponderDocument
  ): Promise<'same' | 'missing' | 'busy' | { token: string }> {
    const previous = await AutoResponderModel.findOne({ guildId: entry.guildId, trigger: entry.trigger }).lean().exec();
    if (!previous) return 'missing';
    if (previous.response === entry.response) return 'same';
    for (const [token, pending] of this.overwrites) {
      if (pending.expiresAt <= Date.now()) this.overwrites.delete(token);
    }
    if (this.overwrites.size >= 1_000) return 'busy';
    const token = randomUUID();
    this.overwrites.set(token, { previous, proposed: { ...entry }, expiresAt: Date.now() + 120_000 });
    return { token };
  }

  public getOverwrite(token: string): PendingOverwrite | undefined {
    const pending = this.overwrites.get(token);
    if (pending && pending.expiresAt <= Date.now()) {
      this.overwrites.delete(token);
      return undefined;
    }
    return pending;
  }

  public async resolveOverwrite(
    token: string,
    guildId: string,
    actorId: string,
    overwrite: boolean
  ): Promise<'updated' | 'cancelled' | 'stale'> {
    const pending = this.getOverwrite(token);
    if (!pending || pending.proposed.guildId !== guildId || pending.proposed.createdBy !== actorId) return 'stale';
    this.overwrites.delete(token);
    if (!overwrite) return 'cancelled';
    const previous = pending.previous;
    const proposed = pending.proposed;
    const result = await AutoResponderModel.updateOne(
      {
        guildId,
        trigger: previous.trigger,
        response: previous.response,
        caseSensitive: previous.caseSensitive,
        useEmbed: previous.useEmbed,
        createdBy: previous.createdBy,
        createdAt: previous.createdAt
      },
      { $set: { response: proposed.response, caseSensitive: proposed.caseSensitive, useEmbed: proposed.useEmbed } },
      { runValidators: true }
    ).exec();
    if (result.matchedCount === 0) return 'stale';
    this.invalidateGuild(guildId);
    return 'updated';
  }

  public invalidateGuild(guildId: string): void {
    this.cache.delete(guildId);
    this.inFlight.delete(guildId);
    for (const [token, pending] of this.overwrites) {
      if (pending.proposed.guildId === guildId) this.overwrites.delete(token);
    }
  }

  public shutdown(): void {
    this.overwrites.clear();
    this.cache.clear();
    this.inFlight.clear();
  }

  private remember(guildId: string, value: AutoResponderDocument[]): void {
    if (!this.cache.has(guildId) && this.cache.size >= this.maxCachedGuilds) {
      const oldestGuildId = this.cache.keys().next().value;
      if (oldestGuildId) this.cache.delete(oldestGuildId);
    }
    this.cache.set(guildId, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export const autoResponderService = new AutoResponderService();
