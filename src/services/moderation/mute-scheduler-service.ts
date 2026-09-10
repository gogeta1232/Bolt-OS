import { container } from '@sapphire/framework';
import type { Guild } from 'discord.js';

import { resolveChannelContext } from '../../config/logging.js';
import { getEmoji } from '../../config/emojis.js';
import { MuteScheduleModel, type MuteScheduleDocument } from '../../database/models/moderation/MuteSchedule.js';

const MAX_TIMEOUT = 2_147_483_647; // ~24 days, Node.js timeout limit

interface ScheduleOptions {
  guildId: string;
  userId: string;
  roleId: string;
  delayMs: number;
}

class MuteSchedulerService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  public async initialize(): Promise<void> {
    this.shutdown();
    const pending = await MuteScheduleModel.find({}).lean().exec();
    for (const entry of pending) {
      this.registerTimeout(entry);
    }
  }

  public async schedule(options: ScheduleOptions): Promise<void> {
    if (options.delayMs <= 0) {
      await this.executeNow({ guildId: options.guildId, userId: options.userId, roleId: options.roleId });
      return;
    }

    const executeAt = new Date(Date.now() + options.delayMs);
    this.clearTimer(options.guildId, options.userId);

    const record = await MuteScheduleModel.findOneAndUpdate(
      { guildId: options.guildId, userId: options.userId },
      { $set: { roleId: options.roleId, executeAt } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();

    this.registerTimeout(
      record ?? { guildId: options.guildId, userId: options.userId, roleId: options.roleId, executeAt }
    );
  }

  public async clear(guildId: string, userId: string): Promise<void> {
    this.clearTimer(guildId, userId);
    await MuteScheduleModel.deleteOne({ guildId, userId }).exec();
  }

  private registerTimeout(entry: Pick<MuteScheduleDocument, 'guildId' | 'userId' | 'roleId' | 'executeAt'>) {
    const delay = entry.executeAt.getTime() - Date.now();
    if (delay <= 0) {
      void this.execute(entry).catch((error) =>
        container.logger.error({ err: error, guildId: entry.guildId }, 'Failed executing overdue mute schedule')
      );
      return;
    }

    const clampedDelay = Math.min(delay, MAX_TIMEOUT);
    const timer = setTimeout(() => {
      if (entry.executeAt.getTime() > Date.now()) {
        this.registerTimeout(entry);
        return;
      }
      void this.execute(entry).catch((error) =>
        container.logger.error({ err: error, guildId: entry.guildId }, 'Failed executing mute schedule')
      );
    }, clampedDelay);
    timer.unref();
    this.timers.set(this.key(entry.guildId, entry.userId), timer);
  }

  public shutdown(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async execute(entry: Pick<MuteScheduleDocument, 'guildId' | 'userId' | 'roleId'>) {
    await this.clear(entry.guildId, entry.userId);
    await this.executeNow(entry);
  }

  private async executeNow(entry: Pick<MuteScheduleDocument, 'guildId' | 'userId' | 'roleId'>) {
    const guild = await container.client.guilds.fetch(entry.guildId).catch(() => null);
    if (!guild) return;

    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.get(entry.roleId) ?? (await guild.roles.fetch(entry.roleId).catch(() => null));
    if (!role) return;

    if (!member.roles.cache.has(role.id)) {
      return;
    }

    try {
      await member.roles.remove(role, 'Scheduled unmute');
      await this.sendLog(guild, member.id, role.id);
    } catch (error) {
      container.logger.error({ err: error, guildId: guild.id }, 'Failed to remove muted role during scheduled unmute');
    }
  }

  private async sendLog(guild: Guild, userId: string, roleId: string) {
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    const role = guild.roles.cache.get(roleId);
    await container.logging.sendModerationLog(
      guild,
      `${getEmoji('mute')} ${member?.user.tag ?? userId} automatically unmuted`,
      {
        target: member?.user ?? null,
        channel: resolveChannelContext(guild.systemChannel ?? null),
        timestamp: Date.now(),
        reason: 'Scheduled unmute complete',
        metadata: {
          Role: role?.name ?? roleId,
          'User ID': userId
        }
      }
    );
  }

  private key(guildId: string, userId: string) {
    return `${guildId}:${userId}`;
  }

  private clearTimer(guildId: string, userId: string) {
    const key = this.key(guildId, userId);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

export const muteSchedulerService = new MuteSchedulerService();
