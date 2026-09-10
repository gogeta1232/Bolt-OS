import { container } from '@sapphire/pieces';

import { CaseModel, type CaseAction, type CaseDocument } from '../../database/models/moderation/Case.js';
import { CaseCounterModel } from '../../database/models/moderation/CaseCounter.js';

interface CreateCaseOptions {
  guildId: string;
  action: CaseAction;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  evidence?: string[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

interface UpdateCaseOptions {
  guildId: string;
  caseId: number;
  moderatorId: string;
  reason?: string;
  evidence?: string[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export class CaseService {
  private readonly caseCache = new Map<string, { case: CaseDocument; timestamp: number }>();
  private readonly CACHE_TTL = 300_000;
  private readonly MAX_CACHE_ENTRIES = 10_000;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  public initialize(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanup(), this.CACHE_TTL);
    this.cleanupInterval.unref();
  }

  public shutdown(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
    this.caseCache.clear();
  }

  /**
   * Initialize counter based on existing cases in the database
   */
  private async initializeCounter(guildId: string): Promise<number> {
    // Find the highest existing case ID
    const highestCase = await CaseModel.findOne({ guildId }).sort({ caseId: -1 }).select('caseId').lean().exec();

    const maxCaseId = highestCase?.caseId ?? 0;

    // Update counter to be at least as high as the max case ID
    const counter = await CaseCounterModel.findOneAndUpdate(
      { guildId },
      { $max: { seq: maxCaseId } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).exec();

    return counter.seq;
  }

  /**
   * Create a new case with atomic ID generation and retry logic
   */
  public async create(options: CreateCaseOptions) {
    const MAX_RETRIES = 5;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Atomically get next case ID
        const counter = await CaseCounterModel.findOneAndUpdate(
          { guildId: options.guildId },
          { $inc: { seq: 1 } },
          { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        ).exec();

        const caseId = counter.seq;

        // Try to create the case
        const document = await CaseModel.create({
          guildId: options.guildId,
          caseId,
          action: options.action,
          targetId: options.targetId,
          targetTag: options.targetTag,
          moderatorId: options.moderatorId,
          moderatorTag: options.moderatorTag,
          reason: options.reason,
          evidence: options.evidence ?? [],
          expiresAt: options.expiresAt ?? null,
          metadata: (options.metadata ?? null) as unknown as Record<string, unknown> | null
        } as unknown as CaseDocument);

        const caseObj = (document as unknown as { toObject(): CaseDocument }).toObject();

        // Cache the new case
        const cacheKey = `${options.guildId}:${caseId}`;
        this.remember(cacheKey, caseObj);

        container.logger.debug({ guildId: options.guildId, caseId }, 'Successfully created case');
        return caseObj;
      } catch (error: unknown) {
        const err = error as Error & { code?: number };

        // If it's a duplicate key error, retry with counter re-initialization
        if (err.code === 11000) {
          lastError = err;
          container.logger.warn(
            { err, guildId: options.guildId, attempt: attempt + 1 },
            'Duplicate case ID detected, reinitializing counter and retrying'
          );

          await this.initializeCounter(options.guildId);

          // Small delay before retry to avoid rapid-fire retries
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }

        // For other errors, log and throw immediately
        container.logger.error({ err, guildId: options.guildId }, 'Failed to create case');
        throw error;
      }
    }

    // If we exhausted all retries, throw the last error
    container.logger.error({ err: lastError, guildId: options.guildId }, 'Failed to create case after maximum retries');
    throw lastError || new Error('Failed to create case after maximum retries');
  }

  /**
   * Fetch case with caching
   */
  public async fetch(guildId: string, caseId: number) {
    const cacheKey = `${guildId}:${caseId}`;
    const cached = this.caseCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.case;
    }

    const caseData = await CaseModel.findOne({ guildId, caseId }).lean().exec();

    if (caseData) {
      this.remember(cacheKey, caseData);
    }

    return caseData;
  }

  /**
   * Update case
   */
  public async update(options: UpdateCaseOptions) {
    const updates: Partial<{
      reason: string;
      evidence: string[];
      expiresAt: Date | null;
      metadata: Record<string, unknown>;
    }> = {};

    if (typeof options.reason === 'string') updates.reason = options.reason;
    if (Array.isArray(options.evidence)) updates.evidence = options.evidence;
    if ('expiresAt' in options) updates.expiresAt = options.expiresAt ?? null;
    if ('metadata' in options) updates.metadata = options.metadata;

    if (Object.keys(updates).length === 0) {
      return this.fetch(options.guildId, options.caseId);
    }

    const updated = await CaseModel.findOneAndUpdate(
      { guildId: options.guildId, caseId: options.caseId, moderatorId: options.moderatorId },
      { $set: updates },
      { returnDocument: 'after' }
    )
      .lean()
      .exec();

    // Invalidate cache
    if (updated) {
      const cacheKey = `${options.guildId}:${options.caseId}`;
      this.caseCache.delete(cacheKey);
    }

    return updated;
  }

  /**
   * List cases for user
   */
  public async listForUser(guildId: string, userId: string, limit = 10, offset = 0) {
    return CaseModel.find({ guildId, targetId: userId }).sort({ caseId: -1 }).skip(offset).limit(limit).lean().exec();
  }

  /**
   * List cases for moderator
   */
  public async listForModerator(guildId: string, moderatorId: string, limit = 10, offset = 0) {
    return CaseModel.find({ guildId, moderatorId }).sort({ caseId: -1 }).skip(offset).limit(limit).lean().exec();
  }

  /**
   * Get latest cases
   */
  public async latest(guildId: string, limit = 10) {
    return CaseModel.find({ guildId }).sort({ caseId: -1 }).limit(limit).lean().exec();
  }

  /**
   * Search cases by keyword
   */
  public async search(guildId: string, query: string, limit = 10) {
    const escapedQuery = this.escapeRegex(query.trim()).slice(0, 200);
    if (!escapedQuery) {
      return this.latest(guildId, limit);
    }

    return CaseModel.find({
      guildId,
      $or: [
        { reason: { $regex: escapedQuery, $options: 'i' } },
        { targetTag: { $regex: escapedQuery, $options: 'i' } },
        { moderatorTag: { $regex: escapedQuery, $options: 'i' } }
      ]
    })
      .sort({ caseId: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Get case statistics
   */
  public async getStats(guildId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalCases, byAction, topModerators] = await Promise.all([
      CaseModel.countDocuments({ guildId, createdAt: { $gte: since } }),
      CaseModel.aggregate([
        { $match: { guildId, createdAt: { $gte: since } } },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      CaseModel.aggregate([
        { $match: { guildId, createdAt: { $gte: since } } },
        { $group: { _id: '$moderatorId', count: { $sum: 1 }, tag: { $first: '$moderatorTag' } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ])
    ]);

    return { totalCases, byAction, topModerators, days };
  }

  /**
   * Delete case
   */
  public async delete(guildId: string, caseId: number) {
    await CaseModel.deleteOne({ guildId, caseId }).exec();

    // Invalidate cache
    const cacheKey = `${guildId}:${caseId}`;
    this.caseCache.delete(cacheKey);
  }

  /**
   * Cleanup old cache entries
   */
  public cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of this.caseCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.caseCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      container.logger.debug({ removed, size: this.caseCache.size }, 'Cleaned up case cache');
    }
  }

  private remember(cacheKey: string, caseData: CaseDocument): void {
    if (!this.caseCache.has(cacheKey) && this.caseCache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.caseCache.keys().next().value as string | undefined;
      if (oldestKey) this.caseCache.delete(oldestKey);
    }
    this.caseCache.set(cacheKey, { case: caseData, timestamp: Date.now() });
  }

  private escapeRegex(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const caseService = new CaseService();
