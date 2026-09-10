import { Events, Listener } from '@sapphire/framework';
import type { Role, User } from 'discord.js';

import { formatPermissionName } from '../../../config/logging.js';

const ROLE_CREATE_AUDIT_TYPE = 30;
const AUDIT_LOG_FETCH_LIMIT = 5;
const AUDIT_LOG_DELAY_MS = 100;
const MAX_PERMS_SHOWN = 6;

export class RoleCreateListener extends Listener<typeof Events.GuildRoleCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildRoleCreate });
  }

  public async run(role: Role) {
    const actor = await this.fetchCreator(role);

    // V2 header carries creator pill + time; body is role mention + color only.
    // Footer carries the role ID via subjectId (actor stays in pills, not footer).
    await this.container.logging.sendRoleLog(role.guild, this.buildDescription(role), {
      actor,
      subjectId: role.id,
      timestamp: Date.now()
    });
  }

  private buildDescription(role: Role): string {
    const perms = role.permissions.toArray().map(formatPermissionName);
    const permsLine =
      perms.length === 0
        ? null
        : `-# ${perms.slice(0, MAX_PERMS_SHOWN).join(' • ')}${perms.length > MAX_PERMS_SHOWN ? ` • +${perms.length - MAX_PERMS_SHOWN} more` : ''}`;
    const lines = [`${role} • ${role.hexColor}`];
    if (permsLine) lines.push(permsLine);
    return lines.join('\n');
  }

  private async fetchCreator(role: Role): Promise<User | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, AUDIT_LOG_DELAY_MS));
      const fetchedLogs = await role.guild.fetchAuditLogs({
        limit: AUDIT_LOG_FETCH_LIMIT,
        type: ROLE_CREATE_AUDIT_TYPE
      });
      for (const [, auditLog] of fetchedLogs.entries) {
        if (auditLog.target?.id !== role.id) continue;
        if (!auditLog.executor) return null;
        return role.guild.client.users.fetch(auditLog.executor.id).catch(() => null);
      }
      return null;
    } catch (error) {
      this.container.logger.debug(
        { err: error, roleId: role.id, guildId: role.guild.id },
        'Error fetching audit logs for role creation'
      );
      return null;
    }
  }
}
