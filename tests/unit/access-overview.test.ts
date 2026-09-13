import { describe, expect, it } from 'vitest';

import { buildAccessContainer, canGrantKey, describeAccess } from '../../src/lib/access-overview.js';

const base = {
  tag: 'mod#1234',
  userId: '111222333444555666',
  nativeKeys: [] as string[],
  botRoleNames: [] as string[],
  modRoleNames: [] as string[],
  botAdminConfigured: true,
  guildPrefix: '!',
  isSelf: true
};

describe('describeAccess', () => {
  it('ranks owner above everything', () => {
    const view = describeAccess({
      ...base,
      isOwner: true,
      nativeKeys: ['Administrator'],
      botRoleNames: ['Mods']
    });
    expect(view.tier).toBe('owner');
    expect(view.accent).toBe('success');
    expect(view.verdict).toContain('both keys');
  });

  it('grants native tier for Administrator without bot roles', () => {
    const view = describeAccess({ ...base, isOwner: false, nativeKeys: ['Administrator'] });
    expect(view.tier).toBe('native');
    expect(view.verdict).toContain('Key I');
    expect(view.verdict).toContain('Administrator');
  });

  it('grants admin tier from a plain role with zero Discord perms', () => {
    const view = describeAccess({ ...base, isOwner: false, botRoleNames: ['Night Shift'] });
    expect(view.tier).toBe('admin-role');
    expect(view.accent).toBe('primary');
    expect(view.verdict).toContain('Night Shift');
    expect(view.setup).toHaveLength(0);
  });

  it('grants mod tier below admin and blocks admin surface', () => {
    const view = describeAccess({ ...base, isOwner: false, modRoleNames: ['Helpers'] });
    expect(view.tier).toBe('mod');
    expect(view.verdict).toContain('Helpers');
    expect(view.verdict).toContain('no grants');
  });

  it('prefers admin over mod when a member holds both', () => {
    const view = describeAccess({ ...base, isOwner: false, botRoleNames: ['A'], modRoleNames: ['M'] });
    expect(view.tier).toBe('admin-role');
  });

  it('denies members and points at setup when roles exist', () => {
    const view = describeAccess({ ...base, isOwner: false });
    expect(view.tier).toBe('member');
    expect(view.setup.join(' ')).toContain('fadmin');
  });

  it('nudges owners to create the first Bolt key when none exist', () => {
    const view = describeAccess({ ...base, isOwner: true, botAdminConfigured: false });
    expect(view.setup.join(' ')).toContain('!fadmin');
  });

  it('uses the guild prefix in setup hints, never a hardcoded one', () => {
    const view = describeAccess({ ...base, isOwner: false, guildPrefix: '?' });
    expect(view.setup.join(' ')).toContain('?fadmin');
    expect(view.setup.join(' ')).not.toContain('!fadmin');
  });

  it('sanitizes backticks out of role names', () => {
    const view = describeAccess({ ...base, isOwner: false, botRoleNames: ['a`b'] });
    expect(view.verdict).not.toContain('a`b');
    expect(view.verdict).toContain("a'b");
  });
});

describe('canGrantKey', () => {
  it('lets only the owner grant admin', () => {
    expect(canGrantKey({ isOwner: true, isAdmin: false }, 'admin')).toBe(true);
    expect(canGrantKey({ isOwner: false, isAdmin: true }, 'admin')).toBe(false);
    expect(canGrantKey({ isOwner: false, isAdmin: false }, 'admin')).toBe(false);
  });

  it('lets owners and admins grant mod, never members', () => {
    expect(canGrantKey({ isOwner: true, isAdmin: false }, 'mod')).toBe(true);
    expect(canGrantKey({ isOwner: false, isAdmin: true }, 'mod')).toBe(true);
    expect(canGrantKey({ isOwner: false, isAdmin: false }, 'mod')).toBe(false);
  });
});

describe('buildAccessContainer', () => {
  it('builds a container with the tier accent color', () => {
    const input = { ...base, isOwner: false, botRoleNames: ['Mods'] };
    const container = buildAccessContainer({ view: describeAccess(input), input });
    const json = container.toJSON() as { accent_color?: number };
    expect(json.accent_color).toBe(0xff482c);
    expect(container).toBeDefined();
  });
});
