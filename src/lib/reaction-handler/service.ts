import { container } from '@sapphire/framework';
import type { MessageReaction, User } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';

interface ReactionProcessingResult {
  processedBy: string[];
  logged: boolean;
}

interface ReactionCacheEntry {
  timestamp: number;
  processed: boolean;
}

const REACTION_CACHE_DURATION = 2000; // 2 seconds
const reactionCache = new Map<string, ReactionCacheEntry>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export class ReactionHandlerService {
  /**
   * Initialize service with cache cleanup
   */
  public initialize(): void {
    if (cleanupInterval) return;
    // Start periodic cache cleanup every 30 seconds
    cleanupInterval = setInterval(() => {
      this.cleanupCache(Date.now());
    }, 30000);
    cleanupInterval.unref();
  }

  /**
   * Handle reaction add with unified processing
   */
  async handleReactionAdd(reaction: MessageReaction, user: User): Promise<ReactionProcessingResult> {
    // Check for duplicate reaction
    if (this.isDuplicateReaction(reaction, user, 'add')) {
      return { processedBy: ['duplicate'], logged: false };
    }

    // Skip bot users
    if (user.bot) {
      await this.logReaction(reaction, user, 'add');
      return { processedBy: ['bot'], logged: true };
    }

    // Fetch partials
    await this.fetchPartials(reaction);

    // Log reaction
    await this.logReaction(reaction, user, 'add');

    return { processedBy: [], logged: true };
  }

  /**
   * Handle reaction remove with unified processing
   */
  async handleReactionRemove(reaction: MessageReaction, user: User): Promise<ReactionProcessingResult> {
    // Check for duplicate reaction
    if (this.isDuplicateReaction(reaction, user, 'remove')) {
      return { processedBy: ['duplicate'], logged: false };
    }

    // Skip bot users
    if (user.bot) {
      await this.logReaction(reaction, user, 'remove');
      return { processedBy: ['bot'], logged: true };
    }

    // Fetch partials
    await this.fetchPartials(reaction);

    // Log reaction
    await this.logReaction(reaction, user, 'remove');

    return { processedBy: [], logged: true };
  }

  /**
   * Cleanup service on shutdown
   */
  public cleanup(): void {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    reactionCache.clear();
  }

  /**
   * Generate unique key for reaction
   */
  private getReactionKey(reaction: MessageReaction, user: User, action: 'add' | 'remove'): string {
    return `${reaction.message.id}-${reaction.emoji.id || reaction.emoji.name}-${user.id}-${action}`;
  }

  /**
   * Check if reaction is duplicate
   */
  private isDuplicateReaction(reaction: MessageReaction, user: User, action: 'add' | 'remove'): boolean {
    const key = this.getReactionKey(reaction, user, action);
    const now = Date.now();

    const cached = reactionCache.get(key);
    if (cached && now - cached.timestamp < REACTION_CACHE_DURATION) {
      return true;
    }

    reactionCache.set(key, { timestamp: now, processed: true });
    return false;
  }

  /**
   * Fetch partial reactions/messages
   */
  private async fetchPartials(reaction: MessageReaction): Promise<void> {
    if (reaction.partial) {
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      await reaction.message.fetch();
    }
  }

  /**
   * Log reaction to channel
   */
  private async logReaction(reaction: MessageReaction, user: User, action: 'add' | 'remove'): Promise<void> {
    try {
      const guild = reaction.message.guild;
      if (!guild) return;

      const description = `${getEmoji(action === 'add' ? 'reactionAdd' : 'reactionRemove')} ${user.toString()} ${action === 'add' ? 'added' : 'removed'} ${reaction.emoji.toString()} ${action === 'add' ? 'to' : 'from'} ${reaction.message.author?.toString() || 'a message'}`;

      const emojiUrl = reaction.emoji.id
        ? reaction.emoji.imageURL({ extension: reaction.emoji.animated ? 'gif' : 'png' })
        : null;

      await container.logging.sendReactionLog(guild, description, {
        actor: null,
        target: null,
        channel: reaction.message.channel,
        message: {
          id: reaction.message.id,
          url: reaction.message.url,
          content: reaction.message.content || null
        },
        timestamp: Date.now(),
        showActorAvatar: false,
        showTargetAvatar: false,
        emojiIconUrl: emojiUrl || undefined,
        metadata: {},
        hideDetailsSection: false
      });
    } catch (error) {
      container.logger.error({ err: error }, `Failed to log ${action} reaction`);
    }
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(now: number): void {
    let removed = 0;
    for (const [key, entry] of reactionCache.entries()) {
      if (now - entry.timestamp > REACTION_CACHE_DURATION * 2) {
        reactionCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      container.logger.debug({ removed, size: reactionCache.size }, 'Cleaned up reaction cache');
    }
  }
}

export const reactionHandlerService = new ReactionHandlerService();
