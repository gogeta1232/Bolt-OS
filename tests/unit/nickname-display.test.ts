import { describe, expect, test } from 'vitest';

import {
  formatNickChange,
  resolveNickChange,
  resolveNickDisplay
} from '../../src/listeners/guild/members/guild-member-update.js';

describe('nickname display fallback', () => {
  test('clearing server nick shows universal nickname, never empty', () => {
    const resolved = resolveNickDisplay('OldNick', null, 'OldNick', 'UniversalName');
    expect(resolved.oldShown).toBe('OldNick');
    expect(resolved.newShown).toBe('UniversalName');
  });

  test('formatNickChange never renders *none* or empty arrow when cleared', () => {
    const line = formatNickChange('OldNick', null, 'OldNick', 'UniversalName');
    expect(line).toContain('OldNick');
    expect(line).toContain('UniversalName');
    expect(line).not.toContain('*none*');
    expect(line).not.toContain('→ ``');
  });

  test('setting nick from none shows previous display to new nick', () => {
    const line = formatNickChange(null, 'NewNick', 'UniversalName', 'NewNick');
    expect(line).toContain('UniversalName');
    expect(line).toContain('NewNick');
    expect(line).not.toContain('*none*');
  });

  test('normal change shows both server nicks', () => {
    const line = formatNickChange('Alpha', 'Beta', 'Alpha', 'Beta');
    expect(line).toContain('Alpha');
    expect(line).toContain('Beta');
  });

  test('first real nickname change after startup is not suppressed', () => {
    const line = resolveNickChange(undefined, 'Before', 'After', 'Before', 'After');
    expect(line).toContain('Before');
    expect(line).toContain('After');
  });
});
