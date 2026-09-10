import { Events, Listener } from '@sapphire/framework';
import type { Role, User } from 'discord.js';

import { formatPermissionName } from '../../../config/logging.js';

const ROLE_UPDATE_AUDIT_TYPE = 31;
const AUDIT_LOG_FETCH_LIMIT = 5;
const AUDIT_LOG_DELAY_MS = 100;
const MAX_PERMS_SHOWN = 3;

export class RoleUpdateListener extends Listener<typeof Events.GuildRoleUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildRoleUpdate });
  }

  public async run(oldRole: Role, newRole: Role) {
    const changes = this.collectChanges(oldRole, newRole);
    if (changes.length === 0) return;

    const actor = await this.fetchUpdater(newRole);

    // WHY role line first: changes alone never say WHICH role changed.
    const description = [`<@&${newRole.id}> • ${newRole.hexColor}`, ...changes].join('\n');
    await this.container.logging.sendRoleLog(newRole.guild, description, {
      actor,
      subjectId: newRole.id,
      timestamp: Date.now()
    });
  }

  private collectChanges(oldRole: Role, newRole: Role): string[] {
    const changes: string[] = [];

    if (oldRole.name !== newRole.name) changes.push(`• Name: ${oldRole.name} → ${newRole.name}`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`• Color: ${oldRole.hexColor} → ${newRole.hexColor}`);
    if (oldRole.hoist !== newRole.hoist)
      changes.push(`• Hoisted: ${this.formatToggle(oldRole.hoist)} → ${this.formatToggle(newRole.hoist)}`);
    if (oldRole.mentionable !== newRole.mentionable)
      changes.push(
        `• Mentionable: ${this.formatToggle(oldRole.mentionable)} → ${this.formatToggle(newRole.mentionable)}`
      );
    if (oldRole.position !== newRole.position) changes.push(`• Position: ${oldRole.position} → ${newRole.position}`);
    if (Boolean(oldRole.icon) !== Boolean(newRole.icon))
      changes.push(`• Icon: ${oldRole.icon ? 'set' : 'none'} → ${newRole.icon ? 'set' : 'none'}`);

    const permChange = this.formatPermissionChange(oldRole, newRole);
    if (permChange) changes.push(permChange);

    return changes;
  }

  private formatPermissionChange(oldRole: Role, newRole: Role): string | null {
    if (oldRole.permissions.bitfield === newRole.permissions.bitfield) return null;
    const oldPerms = oldRole.permissions.toArray();
    const newPerms = newRole.permissions.toArray();
    const parts: string[] = [];

    const added = newPerms.filter((perm) => !oldPerms.includes(perm));
    if (added.length > 0)
      parts.push(
        `+${added.slice(0, MAX_PERMS_SHOWN).map(formatPermissionName).join(', ')}${added.length > MAX_PERMS_SHOWN ? ` +${added.length - MAX_PERMS_SHOWN} more` : ''}`
      );

    const removed = oldPerms.filter((perm) => !newPerms.includes(perm));
    if (removed.length > 0)
      parts.push(
        `-${removed.slice(0, MAX_PERMS_SHOWN).map(formatPermissionName).join(', ')}${removed.length > MAX_PERMS_SHOWN ? ` +${removed.length - MAX_PERMS_SHOWN} more` : ''}`
      );

    if (parts.length === 0) return '• Permissions changed';
    return `• Perms: ${parts.join(' ')}`;
  }

  private formatToggle(value: boolean): string {
    return value ? 'on' : 'off';
  }

  private async fetchUpdater(newRole: Role): Promise<User | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, AUDIT_LOG_DELAY_MS));
      const fetchedLogs = await newRole.guild.fetchAuditLogs({
        limit: AUDIT_LOG_FETCH_LIMIT,
        type: ROLE_UPDATE_AUDIT_TYPE
      });
      for (const [, auditLog] of fetchedLogs.entries) {
        if (auditLog.target?.id !== newRole.id) continue;
        if (!auditLog.executor) return null;
        return newRole.guild.client.users.fetch(auditLog.executor.id).catch(() => null);
      }
      return null;
    } catch (error) {
      this.container.logger.debug(
        { err: error, roleId: newRole.id, guildId: newRole.guild.id },
        'Error fetching audit logs for role update'
      );
      return null;
    }
  }
}
