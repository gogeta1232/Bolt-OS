import { container } from '@sapphire/framework';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

import { GreetDeletionModel, type GreetDeletionDocument } from '../../database/models/features/GreetDeletion.js';
import { resolveGreetDuration } from '../../lib/greeting.js';

const IDLE_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const MAX_BATCH_SIZE = 25;

interface GreetingTarget {
  guildId: string;
  userId: string;
  mention: string;
}

export class GreetingService {
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private wakeAt = Infinity;
  private worker: Promise<void> | undefined;
  private closing = false;
  private activeGreetings = 0;
  private greetingsDrained: Promise<void> | undefined;
  private onGreetingsDrained: (() => void) | undefined;

  public initialize(): void {
    if (this.started) return;
    this.closing = false;
    this.started = true;
    this.wake(0);
  }

  public async shutdown(): Promise<void> {
    this.started = false;
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.wakeAt = Infinity;
    if (this.activeGreetings > 0 && !this.greetingsDrained) {
      this.greetingsDrained = new Promise<void>((resolve) => {
        this.onGreetingsDrained = resolve;
      });
    }
    await Promise.all([this.worker, this.greetingsDrained]);
  }

  public async clearGuild(guildId: string): Promise<void> {
    await GreetDeletionModel.deleteMany({ guildId }).exec();
  }

  public async greet(target: GreetingTarget): Promise<void> {
    if (this.closing) return;
    this.activeGreetings++;
    try {
      await this.sendGreeting(target);
    } finally {
      this.activeGreetings--;
      if (this.activeGreetings === 0) {
        this.onGreetingsDrained?.();
        this.onGreetingsDrained = undefined;
        this.greetingsDrained = undefined;
      }
    }
  }

  private async sendGreeting(target: GreetingTarget): Promise<void> {
    const guild = container.client.guilds.cache.get(target.guildId);
    if (!guild?.available) return;
    const config = await container.config.fetch(target.guildId);
    const durationMs = resolveGreetDuration(config.greetDurationMs);
    const template = config.greetMessage || 'Welcome to the server, {{user}}!';
    const content = template.replace('{{user}}', target.mention);

    for (const channelId of config.greetChannels ?? []) {
      if (this.closing) break;
      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isTextBased() || !('send' in channel)) continue;
        const sent = await channel.send({ content, allowedMentions: { parse: [], users: [target.userId] } });
        const deleteAt = new Date(sent.createdTimestamp + durationMs);
        try {
          await GreetDeletionModel.create({
            guildId: target.guildId,
            channelId,
            messageId: sent.id,
            deleteAt,
            nextAttemptAt: deleteAt
          });
        } catch (error) {
          // A greeting must not intentionally remain permanent when scheduling fails.
          await sent
            .delete()
            .catch((deleteError: unknown) =>
              container.logger.error(
                { err: deleteError, channelId, messageId: sent.id },
                'Failed to remove unscheduled greeting'
              )
            );
          throw error;
        }
        this.wake(Math.max(0, deleteAt.getTime() - Date.now()));
      } catch (error) {
        container.logger.error(
          { err: error, guildId: target.guildId, userId: target.userId, channelId },
          'Failed to greet new member in channel'
        );
      }
    }
  }

  private wake(delayMs: number): void {
    if (!this.started) return;
    const delay = Math.min(Math.max(0, delayMs), IDLE_DELAY_MS);
    const deadline = Date.now() + delay;
    if (deadline >= this.wakeAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.wakeAt = deadline;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wakeAt = Infinity;
      this.startWorker();
    }, delay);
    this.timer.unref();
  }

  private startWorker(): void {
    if (!this.started) return;
    if (this.worker) {
      this.wake(1_000);
      return;
    }
    let delay = IDLE_DELAY_MS;
    this.worker = this.processDue()
      .then((nextDelay) => {
        delay = nextDelay;
      })
      .catch((error: unknown) => container.logger.error({ err: error }, 'Greeting deletion worker failed'))
      .finally(() => {
        this.worker = undefined;
        this.wake(delay);
      });
  }

  private async processDue(): Promise<number> {
    if (!container.client.isReady()) return IDLE_DELAY_MS;
    const guildIds = [...container.client.guilds.cache.keys()];
    if (guildIds.length === 0) return IDLE_DELAY_MS;

    for (let count = 0; count < MAX_BATCH_SIZE && this.started; count++) {
      const now = new Date();
      // Moving nextAttemptAt atomically leases the job to one worker. A crash leaves it retryable.
      const entry = await GreetDeletionModel.findOneAndUpdate(
        { guildId: { $in: guildIds }, nextAttemptAt: { $lte: now }, deleteAt: { $lte: now } },
        { $set: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) } },
        { sort: { nextAttemptAt: 1 }, returnDocument: 'after' }
      )
        .lean()
        .exec();
      if (!entry) break;
      const claim = { messageId: entry.messageId, nextAttemptAt: entry.nextAttemptAt };
      try {
        await this.deleteGreeting(entry);
        await GreetDeletionModel.deleteOne(claim).exec();
      } catch (error) {
        await GreetDeletionModel.updateOne(claim, {
          $set: { nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS) }
        }).exec();
        container.logger.warn(
          { err: error, guildId: entry.guildId, channelId: entry.channelId, messageId: entry.messageId },
          'Greeting deletion failed; will retry'
        );
      }
    }

    const next = await GreetDeletionModel.findOne({ guildId: { $in: guildIds } })
      .sort({ nextAttemptAt: 1 })
      .lean()
      .exec();
    if (!next) return IDLE_DELAY_MS;
    // Always compare real deadlines; long durations never reach setTimeout's maximum delay.
    return Math.max(100, Math.max(next.deleteAt.getTime(), next.nextAttemptAt.getTime()) - Date.now());
  }

  private async deleteGreeting(entry: GreetDeletionDocument): Promise<void> {
    const guild = container.client.guilds.cache.get(entry.guildId);
    if (!guild?.available) throw new Error('Greeting guild is temporarily unavailable');
    try {
      const channel = await guild.channels.fetch(entry.channelId);
      if (!channel?.isTextBased()) return;
      const message = await channel.messages.fetch(entry.messageId);
      if (message.author.id !== container.client.user?.id) {
        container.logger.warn({ messageId: entry.messageId }, 'Ignoring greeting deletion for another author');
        return;
      }
      await message.delete();
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        (error.code === RESTJSONErrorCodes.UnknownMessage ||
          error.code === RESTJSONErrorCodes.UnknownChannel ||
          error.code === RESTJSONErrorCodes.UnknownGuild)
      )
        return;
      throw error;
    }
  }
}
