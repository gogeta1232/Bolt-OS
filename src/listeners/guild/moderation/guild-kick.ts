import { Events, Listener } from '@sapphire/framework';
import { AuditLogEvent, type GuildMember } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

const AUDIT_LOG_FETCH_LIMIT = 5;
const AUDIT_LOG_DELAY_MS = 1000;
const KICK_FRESHNESS_MS = 15_000;

/**
 * Detects kicks done WITHOUT the bot (native Discord kick, another bot, etc.)
 * by matching GuildMemberRemove against the audit log.
 * WHY separate from the leave log: a kick has an executor + reason worth their own entry.
 */
export class GuildKickDetectListener extends Listener<typeof Events.GuildMemberRemove> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberRemove });
  }

  public override async run(member: GuildMember) {
    try {
      // Bot's own removal: nothing to send to (and the leave log already fired).
      if (member.id === member.guild.client.user?.id) return;

      const kick = await this.findKickEntry(member);
      // No kick entry (plain leave), or the bot itself kicked via command
      // (already logged by the moderation action) — stay silent.
      if (!kick || kick.executorId === member.guild.client.user?.id) return;

      const lines = [`${getEmoji('kick')} <@${kick.executorId}> kicked ${member.user}`];
      if (kick.reason) lines.push(`**Reason:** ${kick.reason}`);

      const executor = await member.guild.client.users.fetch(kick.executorId).catch(() => null);
      await this.container.logging.sendAdministrativeLog(member.guild, lines.join('\n'), {
        actor: executor,
        target: member.user,
        showTargetAvatar: true,
        timestamp: Date.now(),
        hideDetailsSection: true
      });
    } catch (error) {
      this.container.logger.debug({ err: error, guildId: member.guild.id, userId: member.id }, 'Kick detect failed');
    }
  }

  private async findKickEntry(member: GuildMember): Promise<{ executorId: string; reason: string | null } | null> {
    try {
      // WHY delay: audit entries land a beat after the gateway event.
      await new Promise((resolve) => setTimeout(resolve, AUDIT_LOG_DELAY_MS));
      const logs = await member.guild.fetchAuditLogs({ limit: AUDIT_LOG_FETCH_LIMIT, type: AuditLogEvent.MemberKick });
      for (const [, entry] of logs.entries) {
        if (entry.target?.id !== member.id) continue;
        if (!entry.executor) continue;
        if (Date.now() - entry.createdTimestamp > KICK_FRESHNESS_MS) continue;
        return { executorId: entry.executor.id, reason: entry.reason ?? null };
      }
      return null;
    } catch {
      // WHY silent: missing ViewAuditLog must never break leave logging.
      return null;
    }
  }
}
