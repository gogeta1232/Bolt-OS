import { Collection, type Message, type PartialMessage } from 'discord.js';
import { container } from '@sapphire/pieces';

export interface SnipedMessage {
  id: string;
  content: string;
  author: {
    id: string;
    tag: string;
    displayName: string;
    avatarURL: string | null;
  };
  channel: {
    id: string;
    name: string;
  };
  timestamp: number;
  attachments: Array<{
    id: string;
    url: string;
    name: string;
    size: number;
    contentType: string | null;
  }>;
  embeds: Array<{
    title?: string | null;
    description?: string | null;
    url?: string | null;
    timestamp?: Date | null;
    color?: number | null;
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    thumbnail?: { url: string } | null;
    image?: { url: string } | null;
    author?: { name: string; iconURL?: string | null; url?: string | null } | null;
    footer?: { text: string; iconURL?: string | null } | null;
  }>;
  stickers: Array<{
    id: string;
    name: string;
    url: string;
  }>;
}

export interface EditedMessage extends SnipedMessage {
  oldContent: string;
  newContent: string;
  editedAt: number;
}

interface SnipeCache {
  deleted: SnipedMessage[];
  edited: EditedMessage[];
  lastActivity: number;
}

export class SnipeService {
  private readonly snipes = new Collection<string, Collection<string, SnipeCache>>();
  private readonly MESSAGE_LIMIT = 10; // Per channel
  private readonly GUILD_LIMIT = 500; // Max guilds in cache
  private readonly TTL = 600000; // 10 minutes
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private activeCollectors = new Set<string>();

  /**
   * Initialize service with cleanup
   */
  public initialize(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
    this.cleanupInterval.unref();

    container.logger.info('Snipe service initialized with cleanup');
  }

  /**
   * Store deleted message
   */
  public storeDeletedMessage(message: Message | PartialMessage): void {
    if (!message.guild) return;

    const cache = this.getOrCreateCache(message.guild.id, message.channel.id);
    const snipe = this.messageToSnipe(message);

    cache.deleted.unshift(snipe);
    if (cache.deleted.length > this.MESSAGE_LIMIT) {
      cache.deleted.splice(this.MESSAGE_LIMIT);
    }

    cache.lastActivity = Date.now();
    this.enforceGuildLimit();
  }

  /**
   * Store edited message
   */
  public storeEditedMessage(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): void {
    if (!newMessage.guild) return;

    const oldContent = 'content' in oldMessage ? (oldMessage.content ?? '') : '';
    const newContent = 'content' in newMessage ? (newMessage.content ?? '') : '';

    if (oldContent === newContent) return;

    const cache = this.getOrCreateCache(newMessage.guild.id, newMessage.channel.id);
    const editSnipe: EditedMessage = {
      ...this.messageToSnipe(newMessage),
      oldContent,
      newContent,
      editedAt: Date.now()
    };

    cache.edited.unshift(editSnipe);
    if (cache.edited.length > this.MESSAGE_LIMIT) {
      cache.edited.splice(this.MESSAGE_LIMIT);
    }

    cache.lastActivity = Date.now();
    this.enforceGuildLimit();
  }

  /**
   * Get deleted message snipe
   */
  public getSnipe(guildId: string, channelId: string, index = 0): SnipedMessage | null {
    const cache = this.getCache(guildId, channelId);
    if (!cache || index < 0 || index >= cache.deleted.length) {
      return null;
    }

    cache.lastActivity = Date.now();
    return cache.deleted[index] ?? null;
  }

  /**
   * Get edited message snipe
   */
  public getEditSnipe(guildId: string, channelId: string, index = 0): EditedMessage | null {
    const cache = this.getCache(guildId, channelId);
    if (!cache || index < 0 || index >= cache.edited.length) {
      return null;
    }

    cache.lastActivity = Date.now();
    return cache.edited[index] ?? null;
  }

  /**
   * Get snipe count
   */
  public getSnipeCount(guildId: string, channelId: string): number {
    const cache = this.getCache(guildId, channelId);
    return cache?.deleted.length ?? 0;
  }

  /**
   * Get edit snipe count
   */
  public getEditSnipeCount(guildId: string, channelId: string): number {
    const cache = this.getCache(guildId, channelId);
    return cache?.edited.length ?? 0;
  }

  /**
   * Clear channel snipes (admin command)
   */
  public clearChannelSnipes(guildId: string, channelId: string): void {
    const guildSnipes = this.snipes.get(guildId);
    if (guildSnipes) {
      guildSnipes.delete(channelId);
    }
  }

  /**
   * Clear all guild snipes
   */
  public clearGuildSnipes(guildId: string): void {
    this.snipes.delete(guildId);
  }

  /**
   * Register collector for tracking
   */
  public registerCollector(messageId: string): void {
    this.activeCollectors.add(messageId);
  }

  /**
   * Unregister collector
   */
  public unregisterCollector(messageId: string): void {
    this.activeCollectors.delete(messageId);
  }

  /**
   * Cleanup service on shutdown
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.snipes.clear();
    this.activeCollectors.clear();
  }

  /**
   * Private: Get or create cache
   */
  private getOrCreateCache(guildId: string, channelId: string): SnipeCache {
    if (!this.snipes.has(guildId)) {
      this.snipes.set(guildId, new Collection<string, SnipeCache>());
    }

    const guildSnipes = this.snipes.get(guildId)!;

    if (!guildSnipes.has(channelId)) {
      guildSnipes.set(channelId, {
        deleted: [],
        edited: [],
        lastActivity: Date.now()
      });
    }

    return guildSnipes.get(channelId)!;
  }

  /**
   * Private: Get cache
   */
  private getCache(guildId: string, channelId: string): SnipeCache | null {
    const guildSnipes = this.snipes.get(guildId);
    if (!guildSnipes) return null;

    return guildSnipes.get(channelId) ?? null;
  }

  /**
   * Private: Convert message to snipe object
   */
  private messageToSnipe(message: Message | PartialMessage): SnipedMessage {
    return {
      id: message.id,
      content: message.content || 'No content',
      author: {
        id: message.author?.id || 'unknown',
        tag: message.author?.tag || 'Unknown#0000',
        displayName: message.member?.displayName || message.author?.username || 'Unknown User',
        avatarURL: message.author?.displayAvatarURL() || null
      },
      channel: {
        id: message.channel.id,
        name: 'name' in message.channel ? (message.channel.name ?? message.channel.id) : message.channel.id
      },
      timestamp: Date.now(),
      attachments: message.attachments
        ? Array.from(message.attachments.values()).map((attachment) => ({
            id: attachment.id,
            url: attachment.url,
            name: attachment.name,
            size: attachment.size,
            contentType: attachment.contentType
          }))
        : [],
      embeds: message.embeds
        ? message.embeds.map((embed) => ({
            title: embed.title,
            description: embed.description,
            url: embed.url,
            timestamp: embed.timestamp ? new Date(embed.timestamp) : null,
            color: embed.color,
            fields: embed.fields,
            thumbnail: embed.thumbnail,
            image: embed.image,
            author: embed.author
              ? {
                  name: embed.author.name,
                  iconURL: embed.author.iconURL,
                  url: embed.author.url
                }
              : null,
            footer: embed.footer
              ? {
                  text: embed.footer.text,
                  iconURL: embed.footer.iconURL
                }
              : null
          }))
        : [],
      stickers: message.stickers
        ? Array.from(message.stickers.values()).map((sticker) => ({
            id: sticker.id,
            name: sticker.name,
            url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`
          }))
        : []
    };
  }

  /**
   * Private: Cleanup old entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removedGuilds = 0;
    let removedChannels = 0;

    for (const [guildId, guildSnipes] of this.snipes.entries()) {
      for (const [channelId, cache] of guildSnipes.entries()) {
        if (now - cache.lastActivity > this.TTL) {
          guildSnipes.delete(channelId);
          removedChannels++;
        }
      }

      if (guildSnipes.size === 0) {
        this.snipes.delete(guildId);
        removedGuilds++;
      }
    }

    if (removedGuilds > 0 || removedChannels > 0) {
      container.logger.debug(
        { removedGuilds, removedChannels, activeGuilds: this.snipes.size },
        'Cleaned up snipe cache'
      );
    }
  }

  /**
   * Private: Enforce guild limit (LRU eviction)
   */
  private enforceGuildLimit(): void {
    if (this.snipes.size <= this.GUILD_LIMIT) return;

    // Sort guilds by last activity
    const guilds = Array.from(this.snipes.entries()).map(([guildId, guildSnipes]) => {
      let lastActivity = 0;
      for (const cache of guildSnipes.values()) {
        lastActivity = Math.max(lastActivity, cache.lastActivity);
      }
      return { guildId, lastActivity };
    });

    guilds.sort((a, b) => a.lastActivity - b.lastActivity);

    const toRemove = guilds.slice(0, this.snipes.size - this.GUILD_LIMIT);
    for (const { guildId } of toRemove) {
      this.snipes.delete(guildId);
    }

    container.logger.debug({ removed: toRemove.length }, 'Enforced guild limit on snipe cache');
  }
}
