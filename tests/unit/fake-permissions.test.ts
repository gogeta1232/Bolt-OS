import { describe, expect, it } from 'vitest';

import { describeAccess } from '../../src/lib/access-overview.js';
import {
  BLOCKED_FAKE_PERMISSIONS,
  formatPermissionList,
  getMemberFakePermissions,
  hasRequiredFakePermission,
  mergePermissions,
  normalizePermissionToken,
  normalizeStoredPermissions,
  parsePermissionTokens,
  removePermissions
} from '../../src/lib/fake-permissions.js';

const baseAccess = {
  tag: 'mod#1234',
  userId: '111222333444555666',
  nativeKeys: [] as string[],
  botRoleNames: [] as string[],
  modRoleNames: [] as string[],
  fakePerms: [] as string[],
  fakeRoleNames: [] as string[],
  botAdminConfigured: true,
  botFakeConfigured: true,
  guildPrefix: '!',
  isSelf: true
};

describe('normalizePermissionToken', () => {
  it('resolves aliases case-insensitively', () => {
    expect(normalizePermissionToken('ban')).toBe('BanMembers');
    expect(normalizePermissionToken('BAN')).toBe('BanMembers');
    expect(normalizePermissionToken('unban')).toBe('BanMembers');
    expect(normalizePermissionToken('kick')).toBe('KickMembers');
    expect(normalizePermissionToken('timeout')).toBe('ModerateMembers');
    expect(normalizePermissionToken('untimeout')).toBe('ModerateMembers');
    expect(normalizePermissionToken('unmute')).toBe('ManageRoles');
    expect(normalizePermissionToken('hide')).toBe('ManageChannels');
    expect(normalizePermissionToken('unhide')).toBe('ManageChannels');
    expect(normalizePermissionToken('purge')).toBe('ManageMessages');
    expect(normalizePermissionToken('slowmode')).toBe('ManageChannels');
    expect(normalizePermissionToken('nick')).toBe('ManageNicknames');
    expect(normalizePermissionToken('voice')).toBe('MoveMembers');
  });

  it('resolves raw Discord flag names', () => {
    expect(normalizePermissionToken('BanMembers')).toBe('BanMembers');
    expect(normalizePermissionToken('banmembers')).toBe('BanMembers');
    expect(normalizePermissionToken('ManageRoles')).toBe('ManageRoles');
  });

  it('allows Administrator via owner-only fake', () => {
    expect(normalizePermissionToken('Administrator')).toBe('Administrator');
    expect(normalizePermissionToken('admin')).toBe('Administrator');
    expect(BLOCKED_FAKE_PERMISSIONS.has('Administrator')).toBe(false);
  });

  it('returns null for unknown tokens', () => {
    expect(normalizePermissionToken('notaperm')).toBeNull();
    expect(normalizePermissionToken('')).toBeNull();
  });
});

describe('parsePermissionTokens', () => {
  it('parses comma and space separated lists', () => {
    const { valid, invalid } = parsePermissionTokens(['ban, kick timeout']);
    expect(valid).toEqual(['BanMembers', 'KickMembers', 'ModerateMembers']);
    expect(invalid).toEqual([]);
  });

  it('deduplicates and sorts', () => {
    const { valid } = parsePermissionTokens(['kick, kick, ban']);
    expect(valid).toEqual(['BanMembers', 'KickMembers']);
  });

  it('reports invalid permissions', () => {
    const { valid, invalid } = parsePermissionTokens(['ban, foobar']);
    expect(valid).toEqual(['BanMembers']);
    expect(invalid).toEqual(expect.arrayContaining(['foobar']));
    const { valid: adminValid } = parsePermissionTokens(['admin']);
    expect(adminValid).toEqual(['Administrator']);
  });

  it('expands presets and handles unban/unmute/untimeout/hide', () => {
    const { valid: chatmod } = parsePermissionTokens(['chatmod']);
    expect(chatmod).toContain('ManageMessages');
    expect(chatmod).toContain('ModerateMembers');
    const { valid: unban } = parsePermissionTokens(['unban']);
    expect(unban).toEqual(['BanMembers']);
    const { valid: hide } = parsePermissionTokens(['hide unhide']);
    expect(hide).toEqual(['ManageChannels']);
    const { valid: all } = parsePermissionTokens(['all']);
    expect(all.length).toBeGreaterThan(5);
  });
});

describe('getMemberFakePermissions', () => {
  it('aggregates perms from held roles only', () => {
    const fakePermissions: Record<string, string[]> = {
      roleA: ['BanMembers', 'KickMembers'],
      roleB: ['ManageMessages'],
      roleC: ['ModerateMembers']
    };
    const perms = getMemberFakePermissions(['roleA', 'roleC'], fakePermissions);
    expect([...perms].sort()).toEqual(['BanMembers', 'KickMembers', 'ModerateMembers']);
  });

  it('handles Map input and ignores unheld roles', () => {
    const fakeMap = new Map<string, string[]>([
      ['roleA', ['BanMembers']],
      ['roleB', ['KickMembers']]
    ]);
    const perms = getMemberFakePermissions(['roleA'], fakeMap);
    expect([...perms]).toEqual(['BanMembers']);
  });

  it('returns empty for no match', () => {
    const perms = getMemberFakePermissions(['roleX'], { roleA: ['BanMembers'] });
    expect(perms.size).toBe(0);
  });
});

describe('hasRequiredFakePermission', () => {
  it('matches if any required perm is held', () => {
    const held = new Set(['KickMembers', 'BanMembers']);
    expect(hasRequiredFakePermission(held, ['KickMembers'])).toBe(true);
    expect(hasRequiredFakePermission(held, ['ManageMessages'])).toBe(false);
    expect(hasRequiredFakePermission(held, ['KickMembers', 'ManageMessages'])).toBe(true);
  });
});

describe('mergePermissions / removePermissions', () => {
  it('merges and respects max limit', () => {
    const merged = mergePermissions(['BanMembers'], ['KickMembers', 'BanMembers']);
    expect(merged).toEqual(['BanMembers', 'KickMembers']);
  });

  it('removes specified perms', () => {
    const remaining = removePermissions(['BanMembers', 'KickMembers', 'ManageMessages'], ['KickMembers']);
    expect(remaining).toEqual(['BanMembers', 'ManageMessages']);
  });
});

describe('normalizeStoredPermissions', () => {
  it('keeps Administrator and filters invalid', () => {
    expect(normalizeStoredPermissions(['BanMembers', 'Administrator', 'notaperm'])).toEqual([
      'Administrator',
      'BanMembers'
    ]);
  });
});

describe('formatPermissionList', () => {
  it('formats empty and populated', () => {
    expect(formatPermissionList([])).toBe('— none');
    expect(formatPermissionList(['BanMembers', 'KickMembers'])).toContain('BanMembers');
  });
});

describe('describeAccess with fake perms', () => {
  it('grants fake tier for granular perms', () => {
    const view = describeAccess({
      ...baseAccess,
      isOwner: false,
      fakePerms: ['KickMembers', 'BanMembers'],
      fakeRoleNames: ['Trial Mod']
    });
    expect(view.tier).toBe('fake');
    expect(view.verdict).toContain('KickMembers');
    expect(view.verdict).toContain('Trial Mod');
  });

  it('prefers admin-role over fake', () => {
    const view = describeAccess({
      ...baseAccess,
      isOwner: false,
      botRoleNames: ['Admin'],
      fakePerms: ['KickMembers']
    });
    expect(view.tier).toBe('admin-role');
  });

  it('prefers fake over legacy mod', () => {
    const view = describeAccess({
      ...baseAccess,
      isOwner: false,
      fakePerms: ['ManageMessages'],
      modRoleNames: ['Helpers']
    });
    expect(view.tier).toBe('fake');
  });

  it('still grants legacy mod when no fake', () => {
    const view = describeAccess({ ...baseAccess, isOwner: false, modRoleNames: ['Helpers'], fakePerms: [] });
    expect(view.tier).toBe('mod');
  });
});
