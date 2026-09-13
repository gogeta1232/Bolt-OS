import { PermissionFlagsBits } from 'discord.js';

export const BLOCKED_FAKE_PERMISSIONS = new Set<string>();

export const OWNER_ONLY_FAKE_PERMISSIONS = new Set<string>(['Administrator']);

export const FAKE_PERMISSION_ALIASES: Readonly<Record<string, string>> = {
  ban: 'BanMembers',
  unban: 'BanMembers',
  softban: 'BanMembers',
  kick: 'KickMembers',
  timeout: 'ModerateMembers',
  untimeout: 'ModerateMembers',
  moderatemembers: 'ModerateMembers',
  moderate: 'ModerateMembers',
  warn: 'ModerateMembers',
  unwarn: 'ModerateMembers',
  mute: 'ManageRoles',
  unmute: 'ManageRoles',
  jail: 'ManageRoles',
  unjail: 'ManageRoles',
  role: 'ManageRoles',
  roles: 'ManageRoles',
  manageroles: 'ManageRoles',
  purge: 'ManageMessages',
  clear: 'ManageMessages',
  clean: 'ManageMessages',
  managemessages: 'ManageMessages',
  slowmode: 'ManageChannels',
  managechannels: 'ManageChannels',
  channel: 'ManageChannels',
  channels: 'ManageChannels',
  hide: 'ManageChannels',
  unhide: 'ManageChannels',
  lock: 'ManageChannels',
  unlock: 'ManageChannels',
  nick: 'ManageNicknames',
  nickname: 'ManageNicknames',
  managenicknames: 'ManageNicknames',
  voice: 'MoveMembers',
  move: 'MoveMembers',
  movemembers: 'MoveMembers',
  deafen: 'DeafenMembers',
  deafenmembers: 'DeafenMembers',
  mutevoice: 'MuteMembers',
  mutemembers: 'MuteMembers',
  cases: 'ViewAuditLog',
  case: 'ViewAuditLog',
  viewauditlog: 'ViewAuditLog',
  audit: 'ViewAuditLog',
  invites: 'CreateInstantInvite',
  invite: 'CreateInstantInvite',
  administrator: 'Administrator',
  admin: 'Administrator'
};

const ALL_PERMISSION_FLAG_NAMES = new Set<string>(
  Object.keys(PermissionFlagsBits).filter((key) => Number.isNaN(Number(key)))
);

export const ALLOWED_FAKE_PERMISSIONS = new Set<string>(
  [...ALL_PERMISSION_FLAG_NAMES].filter((name) => !BLOCKED_FAKE_PERMISSIONS.has(name))
);

const ALIAS_KEYS = new Set(Object.keys(FAKE_PERMISSION_ALIASES));

export const normalizePermissionToken = (token: string): string | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return null;
  const aliased = FAKE_PERMISSION_ALIASES[lower];
  if (aliased) return aliased;
  if (ALIAS_KEYS.has(lower)) return FAKE_PERMISSION_ALIASES[lower] ?? null;
  const direct = [...ALL_PERMISSION_FLAG_NAMES].find((name) => name.toLowerCase() === lower);
  if (direct && !BLOCKED_FAKE_PERMISSIONS.has(direct)) return direct;
  return null;
};

export interface ParsePermissionsResult {
  readonly valid: string[];
  readonly invalid: string[];
}

export const parsePermissionTokens = (tokens: readonly string[]): ParsePermissionsResult => {
  const validSet = new Set<string>();
  const invalid: string[] = [];
  for (const raw of tokens) {
    const parts = raw
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const part of parts) {
      const lower = part.toLowerCase().replace(/[^a-z]/g, '');
      const presetKey = lower === 'all' ? 'full' : lower;
      const preset = FAKE_PERMISSION_PRESETS[presetKey];
      if (preset) {
        for (const presetPerm of preset) {
          const normalizedPreset = normalizePermissionToken(presetPerm);
          if (normalizedPreset) validSet.add(normalizedPreset);
        }
        continue;
      }
      const normalized = normalizePermissionToken(part);
      if (normalized && ALLOWED_FAKE_PERMISSIONS.has(normalized)) {
        validSet.add(normalized);
      } else if (normalized && BLOCKED_FAKE_PERMISSIONS.has(normalized)) {
        invalid.push(part);
      } else if (!normalized) {
        // Try again with original token as one permission name (handles underscores)
        const fallback = normalizePermissionToken(part.replace(/_/g, ''));
        if (fallback && ALLOWED_FAKE_PERMISSIONS.has(fallback)) {
          validSet.add(fallback);
        } else {
          invalid.push(part);
        }
      } else {
        invalid.push(part);
      }
    }
  }
  return { valid: [...validSet].sort(), invalid: [...new Set(invalid)].sort() };
};

export const splitPermissionInput = (input: string | null | undefined): string[] => {
  if (!input) return [];
  return input
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

export const formatPermissionList = (perms: readonly string[]): string =>
  perms.length === 0 ? '— none' : perms.map((perm) => `\`${perm}\``).join(' · ');

export const MAX_FAKE_ROLES_PER_GUILD = 25;
export const MAX_FAKE_PERMS_PER_ROLE = 15;

export const normalizeStoredPermissions = (perms: readonly string[] | undefined): string[] => {
  if (!perms || perms.length === 0) return [];
  const valid = perms
    .map((perm) => normalizePermissionToken(perm))
    .filter((perm): perm is string => perm !== null && ALLOWED_FAKE_PERMISSIONS.has(perm));
  return [...new Set(valid)].sort();
};

export const getMemberFakePermissions = (
  memberRoleIds: readonly string[],
  fakePermissions: Readonly<Record<string, readonly string[]>> | Readonly<Map<string, readonly string[]>> | undefined
): Set<string> => {
  if (!fakePermissions) return new Set();
  const aggregated = new Set<string>();
  const entries: Array<[string, readonly string[]]> =
    fakePermissions instanceof Map ? [...fakePermissions.entries()] : Object.entries(fakePermissions);
  const roleSet = new Set(memberRoleIds);
  for (const [roleId, perms] of entries) {
    if (!roleSet.has(roleId)) continue;
    for (const perm of perms) {
      const normalized = normalizePermissionToken(perm);
      if (normalized) aggregated.add(normalized);
    }
  }
  return aggregated;
};

export const hasRequiredFakePermission = (
  memberFakePerms: ReadonlySet<string>,
  requiredPerms: readonly string[]
): boolean => requiredPerms.some((perm) => memberFakePerms.has(perm));

export const mergePermissions = (existing: readonly string[], toAdd: readonly string[]): string[] => {
  const merged = new Set(
    [...existing, ...toAdd]
      .map((perm) => normalizePermissionToken(perm))
      .filter((perm): perm is string => perm !== null)
  );
  return [...merged].sort().slice(0, MAX_FAKE_PERMS_PER_ROLE);
};

export const removePermissions = (existing: readonly string[], toRemove: readonly string[]): string[] => {
  const removeSet = new Set(
    toRemove.map((perm) => normalizePermissionToken(perm)).filter((perm): perm is string => perm !== null)
  );
  return existing.filter((perm) => {
    const normalized = normalizePermissionToken(perm);
    return normalized ? !removeSet.has(normalized) : false;
  });
};

export const describeFakePermissionsInput = (input: string): string => {
  const { valid, invalid } = parsePermissionTokens([input]);
  if (invalid.length > 0) return `Invalid: ${invalid.join(', ')}`;
  return formatPermissionList(valid);
};

export const FAKE_PERMISSION_CHOICES: readonly string[] = [
  'admin',
  'ban',
  'unban',
  'softban',
  'kick',
  'timeout',
  'untimeout',
  'warn',
  'mute',
  'unmute',
  'jail',
  'unjail',
  'purge',
  'slowmode',
  'nick',
  'role',
  'voice',
  'hide',
  'unhide',
  'cases'
];

export const FAKE_PERMISSION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  admin: 'Fake Administrator — full access + can grant mods (owner only)',
  ban: 'Ban members (`BanMembers`)',
  unban: 'Unban members (`BanMembers`)',
  softban: 'Softban — ban then unban to clear messages',
  kick: 'Kick members (`KickMembers`)',
  timeout: 'Timeout members (`ModerateMembers`)',
  untimeout: 'Remove timeout (`ModerateMembers`)',
  warn: 'Warn and manage warnings',
  mute: 'Mute with role (`ManageRoles`)',
  unmute: 'Unmute (`ManageRoles`)',
  jail: 'Jail to a channel (`ManageRoles` + `ModerateMembers`)',
  unjail: 'Unjail (`ManageRoles` + `ModerateMembers`)',
  purge: 'Purge/clear messages (`ManageMessages`)',
  slowmode: 'Set slowmode / lock channel (`ManageChannels`)',
  nick: 'Change nicknames (`ManageNicknames`)',
  role: 'Toggle roles (`ManageRoles`)',
  voice: 'Voice — move/mute/deafen (`MoveMembers`)',
  hide: 'Hide channel (`ManageChannels`)',
  unhide: 'Unhide channel (`ManageChannels`)',
  cases: 'View cases and mod logs (`ViewAuditLog`)'
};

export const FAKE_PERMISSION_PRESETS: Readonly<Record<string, readonly string[]>> = {
  chatmod: ['purge', 'slowmode', 'timeout', 'untimeout', 'warn'],
  mod: ['kick', 'timeout', 'untimeout', 'warn', 'mute', 'unmute', 'purge', 'slowmode', 'nick'],
  seniormod: [
    'ban',
    'unban',
    'softban',
    'kick',
    'timeout',
    'untimeout',
    'warn',
    'mute',
    'unmute',
    'jail',
    'unjail',
    'purge',
    'slowmode',
    'nick',
    'role',
    'hide',
    'unhide',
    'voice'
  ],
  full: [
    'ban',
    'unban',
    'softban',
    'kick',
    'timeout',
    'untimeout',
    'warn',
    'mute',
    'unmute',
    'jail',
    'unjail',
    'purge',
    'slowmode',
    'nick',
    'role',
    'voice',
    'hide',
    'unhide',
    'cases'
  ]
};
