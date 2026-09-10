import { Events, Listener } from '@sapphire/framework';
import { AttachmentBuilder, ContainerBuilder, MessageFlags, TextDisplayBuilder, type Message } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';
import { theme } from '../../../config/theme.js';
import { buildAfkMentionContainer } from '../../../lib/afk-views.js';
import { resolveChannelContext } from '../../../config/logging.js';
import { downloadDiscordImage } from '../../../lib/remote-media.js';

const NOTIFY_COOLDOWN = 60_000; // 1 minute
const AFK_FETCH_TIMEOUT_MS = 8000;
const AFK_MAX_BYTES = 8_000_000;

const tryFetchAfkFile = async (url: string): Promise<AttachmentBuilder | null> => {
  const downloaded = await downloadDiscordImage(url, { maxBytes: AFK_MAX_BYTES, timeoutMs: AFK_FETCH_TIMEOUT_MS });
  if (!downloaded) return null;
  const extension = downloaded.extension === 'bin' ? 'png' : downloaded.extension;
  return new AttachmentBuilder(downloaded.data, { name: `afk-${Date.now()}.${extension}` });
};

export class AfkListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate });
  }

  public async run(message: Message) {
    if (message.author.bot || !message.guild) return;

    try {
      const isAfkCommand = this.isAfkCommand(message.content);
      const wasReset = isAfkCommand ? false : await this.handleAutoreset(message);
      if (!wasReset) {
        await this.handleMentions(message);
      }
    } catch (error) {
      console.error('[AfkListener] Error processing message:', error);
    }
  }

  private isAfkCommand(content: string): boolean {
    const trimmed = content.trim().toLowerCase();
    const prefixPatterns = [/^[!.?]afk\s*/i, /^afk\s*/i];
    return prefixPatterns.some((pattern) => pattern.test(trimmed));
  }

  private async handleAutoreset(message: Message): Promise<boolean> {
    try {
      const profile = await this.container.afk.fetch(message.guild!.id, message.author.id);
      if (!profile) return false;

      const cleared = await this.container.afk.clear(message.guild!.id, message.author.id);
      if (!cleared) return false;

      const afkDuration = Date.now() - new Date(profile.setAt).getTime();
      const afkDurationSeconds = Math.floor(afkDuration / 1000);

      if ('send' in message.channel) {
        try {
          const emoji = getEmoji('afk') || getEmoji('sleep');
          const container = new ContainerBuilder().setAccentColor(theme.colors.success);
          const rawReason = profile.message.trim() || 'AFK';
          const displayReason = rawReason.length > 60 ? `${rawReason.slice(0, 57)}…` : rawReason;
          const singleLine = `${emoji} │ Welcome back ${message.author} — \`${this.formatDuration(afkDurationSeconds)}\` · *${displayReason.replace(/`/g, "'")}*`;
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(singleLine));
          // Minimal sleek — no extra footer, just the single line
          try {
            const json = container.toJSON() as { components?: unknown[] };
            if (json.components?.length)
              (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
          } catch {
            void 0;
          }
          await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 } as never);
        } catch (error) {
          console.error('[AfkListener] Error sending welcome back message:', error);
        }
      }

      const channelContext = message.inGuild() ? resolveChannelContext(message.channel) : null;
      this.container.logging
        .sendMemberUpdateLog(message.guild!, `${message.author.tag} returned from AFK`, {
          target: message.author,
          channel: channelContext,
          timestamp: Date.now()
        })
        .catch((error) => {
          console.error('[AfkListener] Error logging AFK return:', error);
        });

      return true;
    } catch (error) {
      console.error('[AfkListener] Error in handleAutoreset:', error);
      return false;
    }
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m ${seconds % 60}s`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }

  private async handleMentions(message: Message) {
    try {
      const mentioned = new Set(message.mentions.users.keys());
      mentioned.delete(message.author.id);
      if (mentioned.size === 0) return;

      const userIds = Array.from(mentioned);
      const profiles = await this.container.afk.fetchBatch(message.guild!.id, userIds);
      if (profiles.size === 0) return;

      const notificationPromises = Array.from(profiles.entries()).map(async ([userId, profile]) => {
        try {
          if (profile.lastNotifiedAt && Date.now() - new Date(profile.lastNotifiedAt).getTime() < NOTIFY_COOLDOWN)
            return;

          const user = message.mentions.users.get(userId);
          const member = message.guild!.members.cache.get(userId);
          const username = member?.displayName ?? user?.tag ?? 'Unknown User';

          if ('send' in message.channel) {
            const rawUrl = (profile as unknown as { attachmentUrl?: string | null }).attachmentUrl ?? null;
            let displayUrl: string | null | undefined = rawUrl ?? undefined;
            let files: AttachmentBuilder[] | undefined;
            if (rawUrl) {
              const fetched = await tryFetchAfkFile(rawUrl);
              if (fetched) {
                files = [fetched];
                const fname = (fetched as unknown as { name?: string }).name ?? `afk-${Date.now()}.gif`;
                displayUrl = `attachment://${fname}`;
              } else {
                // If cdn.discordapp.com 404 (expired), hide broken gallery instead of showing failed image
                try {
                  const u = new URL(rawUrl);
                  if (u.host === 'cdn.discordapp.com') displayUrl = undefined;
                } catch {
                  // keep external for non-cdn (giphy etc may still work via MediaGallery)
                }
              }
            }
            const payload = buildAfkMentionContainer({
              username,
              userId,
              message: profile.message,
              attachmentUrl: displayUrl ?? null,
              setAt: new Date(profile.setAt)
            });
            if (files) {
              await message.channel.send({ ...payload, files } as never);
            } else {
              await message.channel.send(payload as never);
            }
          }

          this.container.afk.markNotified(message.guild!.id, userId).catch((error) => {
            console.error('[AfkListener] Error marking notification:', error);
          });
        } catch (error) {
          console.error(`[AfkListener] Error processing mention for user ${userId}:`, error);
        }
      });

      await Promise.all(notificationPromises);
    } catch (error) {
      console.error('[AfkListener] Error in handleMentions:', error);
    }
  }
}
