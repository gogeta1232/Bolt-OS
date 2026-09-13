import type { Guild, GuildMember, PermissionResolvable } from 'discord.js';
import { container } from '@sapphire/pieces';

import { getMemberFakePermissions, hasRequiredFakePermission, normalizePermissionToken } from '../fake-permissions.js';

/**
 * Result of permission check with detailed information.
 * Chain: owner → Administrator → command Discord perm → adminRole → fakePerm → modRole.
 * adminRole = full bot access. modRole = moderation commands only, never admin
 * surface, never grants. fakePerm = granular per-permission grants without real Discord perms.
 * Both are plain Discord roles imbued by Bolt.
 */
export interface PermissionCheckResult {
  hasPermission: boolean;
  permissionType: 'owner' | 'administrator' | 'realPerms' | 'adminRole' | 'fakePerms' | 'modRole' | 'none';
  checkedAdminRoles?: string[];
  matchedFakePerms?: string[];
}

export const REAL_PERMISSION_BY_COMMAND: Record<string, PermissionResolvable[]> = {
  ban: ['BanMembers'],
  unban: ['BanMembers'],
  softban: ['BanMembers'],
  kick: ['KickMembers'],
  timeout: ['ModerateMembers'],
  untimeout: ['ModerateMembers'],
  warn: ['ModerateMembers', 'KickMembers', 'BanMembers', 'ManageMessages'],
  mute: ['ManageRoles'],
  unmute: ['ManageRoles'],
  jail: ['ModerateMembers', 'ManageRoles'],
  unjail: ['ModerateMembers', 'ManageRoles'],
  purge: ['ManageMessages'],
  slowmode: ['ManageChannels'],
  hide: ['ManageChannels'],
  unhide: ['ManageChannels'],
  voice: ['MoveMembers', 'MuteMembers', 'DeafenMembers'],
  nick: ['ManageNicknames'],
  role: ['ManageRoles'],
  manage_roles: ['ManageRoles'],
  manage_channels: ['ManageChannels'],
  cases: ['ViewAuditLog', 'ManageGuild'],
  mod_tooling: ['ManageGuild']
};

const DEFAULT_REAL_PERMISSIONS: PermissionResolvable[] = ['ManageGuild'];

export const getRequiredRealPermissions = (commandType: string): PermissionResolvable[] =>
  REAL_PERMISSION_BY_COMMAND[commandType.toLowerCase()] ?? DEFAULT_REAL_PERMISSIONS;

/**
 * Permission checker: owner → admin → command Discord perm → adminRole → fakePerm → modRole.
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

  const botKeys = await checkBotKeys(guild.id, member);

  if (botKeys.hasAdminRole) {
    return {
      hasPermission: true,
      permissionType: 'adminRole',
      checkedAdminRoles: botKeys.adminRoleIds
    };
  }

  // Fake Administrator — owner-only grant, treated as admin for all commands
  if (botKeys.hasFakeAdmin) {
    return {
      hasPermission: true,
      permissionType: 'fakePerms',
      matchedFakePerms: ['Administrator']
    };
  }

  const fakeCheck = hasGranularFakePermission(botKeys.fakePermissions, member, commandType);
  if (fakeCheck.hasPermission) {
    return {
      hasPermission: true,
      permissionType: 'fakePerms',
      matchedFakePerms: fakeCheck.matched
    };
  }

  if (botKeys.hasModRole) {
    return {
      hasPermission: true,
      permissionType: 'modRole',
      checkedAdminRoles: botKeys.modRoleIds
    };
  }

  return { hasPermission: false, permissionType: 'none' };
}

const hasGranularFakePermission = (
  fakePermissions: Readonly<Record<string, readonly string[]>> | undefined,
  member: GuildMember,
  commandType: string
): { hasPermission: boolean; matched: string[] } => {
  if (!fakePermissions || Object.keys(fakePermissions).length === 0) return { hasPermission: false, matched: [] };
  const memberRoleIds = [...member.roles.cache.keys()];
  const fakeSet = getMemberFakePermissions(memberRoleIds, fakePermissions);
  if (fakeSet.size === 0) return { hasPermission: false, matched: [] };
  const required = getRequiredRealPermissions(commandType).map((perm) => {
    const normalized = normalizePermissionToken(String(perm));
    return normalized ?? String(perm);
  });
  const matched = required.filter((perm) => fakeSet.has(perm));
  if (hasRequiredFakePermission(fakeSet, required)) {
    return { hasPermission: true, matched };
  }
  return { hasPermission: false, matched: [] };
};

async function checkBotKeys(
  guildId: string,
  member: GuildMember
): Promise<{
  hasAdminRole: boolean;
  hasModRole: boolean;
  hasFakeAdmin: boolean;
  adminRoleIds: string[];
  modRoleIds: string[];
  fakePermissions: Record<string, string[]>;
}> {
  try {
    const config = await container.config.fetch(guildId);
    const adminRoleIds = config.adminRoleIds || [];
    const modRoleIds = config.modRoleIds || [];
    const fakePermissions = (config.fakePermissions ?? {}) as Record<string, string[]>;
    const hasFakeAdmin = Object.entries(fakePermissions).some(
      ([roleId, perms]) => member.roles.cache.has(roleId) && (perms as string[]).includes('Administrator')
    );
    return {
      hasAdminRole: adminRoleIds.some((roleId: string) => member.roles.cache.has(roleId)),
      hasModRole: modRoleIds.some((roleId: string) => member.roles.cache.has(roleId)),
      hasFakeAdmin,
      adminRoleIds,
      modRoleIds,
      fakePermissions
    };
  } catch (error) {
    container.logger.warn({ err: error, guildId }, 'Failed to load bot role configuration');
    return {
      hasAdminRole: false,
      hasModRole: false,
      hasFakeAdmin: false,
      adminRoleIds: [],
      modRoleIds: [],
      fakePermissions: {}
    };
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
