import type { Guild, GuildMember, PermissionResolvable } from 'discord.js';
import { container } from '@sapphire/pieces';

/**
 * Result of permission check with detailed information.
 * Native Discord perms first, configured adminRoleIds as fallback.
 * No custom DB permission layer — single source of truth is Discord.
 */
export interface PermissionCheckResult {
  hasPermission: boolean;
  permissionType: 'owner' | 'administrator' | 'realPerms' | 'adminRole' | 'none';
  checkedAdminRoles?: string[];
}

const REAL_PERMISSION_BY_COMMAND: Record<string, PermissionResolvable[]> = {
  ban: ['BanMembers'],
  unban: ['BanMembers'],
  softban: ['BanMembers'],
  kick: ['KickMembers'],
  timeout: ['ModerateMembers'],
  warn: ['ModerateMembers', 'KickMembers', 'BanMembers', 'ManageMessages'],
  mute: ['ManageRoles'],
  jail: ['ModerateMembers', 'ManageRoles'],
  unjail: ['ModerateMembers', 'ManageRoles'],
  purge: ['ManageMessages'],
  slowmode: ['ManageChannels'],
  voice: ['MoveMembers', 'MuteMembers', 'DeafenMembers'],
  nick: ['ManageNicknames'],
  role: ['ManageRoles'],
  manage_roles: ['ManageRoles'],
  manage_channels: ['ManageChannels'],
  cases: ['ViewAuditLog', 'ManageGuild'],
  mod_tooling: ['ManageGuild']
};

const DEFAULT_REAL_PERMISSIONS: PermissionResolvable[] = ['ManageGuild'];

const getRequiredRealPermissions = (commandType: string) =>
  REAL_PERMISSION_BY_COMMAND[commandType.toLowerCase()] ?? DEFAULT_REAL_PERMISSIONS;

/**
 * Permission checker: owner → admin → command Discord perm → adminRole.
 * Sync checks first, single async config fetch only as last resort.
 */
export async function checkModerationPermission(
  guild: Guild,
  member: GuildMember,
  userId: string,
  commandType: string
): Promise<PermissionCheckResult> {
  if (userId === guild.ownerId) {
    return { hasPermission: true, permissionType: 'owner' };
  }

  if (member.permissions.has('Administrator')) {
    return { hasPermission: true, permissionType: 'administrator' };
  }

  const hasRealPerms = getRequiredRealPermissions(commandType).some((permission) => member.permissions.has(permission));

  if (hasRealPerms) {
    return { hasPermission: true, permissionType: 'realPerms' };
  }

  const adminRoleCheck = await checkAdminRole(guild.id, member);

  if (adminRoleCheck.hasRole) {
    return {
      hasPermission: true,
      permissionType: 'adminRole',
      checkedAdminRoles: adminRoleCheck.roleIds
    };
  }

  return { hasPermission: false, permissionType: 'none' };
}

async function checkAdminRole(guildId: string, member: GuildMember): Promise<{ hasRole: boolean; roleIds: string[] }> {
  try {
    const config = await container.config.fetch(guildId);
    const adminRoleIds = config.adminRoleIds || [];
    const hasRole = adminRoleIds.some((roleId: string) => member.roles.cache.has(roleId));

    return { hasRole, roleIds: adminRoleIds };
  } catch (error) {
    container.logger.warn({ err: error, guildId }, 'Failed to load admin role configuration');
    return { hasRole: false, roleIds: [] };
  }
}

export async function hasModerationPermission(
  guild: Guild,
  member: GuildMember,
  userId: string,
  commandType: string
): Promise<boolean> {
  const result = await checkModerationPermission(guild, member, userId, commandType);
  return result.hasPermission;
}
