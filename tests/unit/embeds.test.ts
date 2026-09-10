import { describe, expect, test } from 'vitest';

import { rich, single, v2 } from '../../src/lib/embeds.js';
import { getEmoji } from '../../src/config/emojis.js';

describe('embeds', () => {
  test('single is one line', () => {
    const { embeds } = single('Banned @user — spam', 'success') as { embeds: [{ data: { description?: string } }] };
    // Canonical toast contract: theme emoji + pipe + message on a single line
    expect(embeds[0].data.description).toBe(`${getEmoji('success')} | Banned @user — spam`);
    expect(embeds[0].data.description?.includes('\n')).toBe(false);
  });

  test('rich trims', () => {
    const e = rich({ title: 'Case', description: 'hello', kind: 'info' });
    expect(e.data.description).toContain('Case');
  });

  test('v2 dense', () => {
    const { components } = v2({ title: 'Server', fields: [{ name: 'Members', value: '1,234' }] }) as {
      components: Array<{ data: { components: unknown[] } }>;
    };
    expect(components[0].data.components.length).toBeGreaterThan(0);
  });
});
