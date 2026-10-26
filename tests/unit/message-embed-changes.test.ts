import { Embed } from 'discord.js';
import { describe, expect, test } from 'vitest';

import {
  embedsAreDifferent,
  formatEmbedChanges,
  formatEmbedEditTranscript
} from '../../src/lib/utils/message-helpers.js';

describe('message embed edits', () => {
  test('different embed layouts show actual field names under separate before and after views', () => {
    const before = new Embed({
      title: 'Normie player',
      fields: [
        { name: 'PROGRESS', value: '**Level:** 3 <:bolt_success:1545312696893972500>' },
        { name: 'STATS', value: '**DEF:** 12' }
      ],
      thumbnail: { url: 'https://example.com/old.png' }
    });
    const after = new Embed({
      author: { name: 'Player — professions' },
      fields: [
        { name: 'Worker', value: 'Lv 2' },
        { name: 'Crafter', value: 'Lv 1' }
      ]
    });
    const result = formatEmbedChanges([before], [after]).join('\n');
    expect(result).toContain('**Before**\n> **Normie player**');
    expect(result).toContain('> **PROGRESS:** **Level:** 3 <:bolt_success:1545312696893972500>');
    expect(result).toContain('**After**\n> Player — professions\n> **Worker:** Lv 2');
    expect(result).not.toContain('PROGRESS → Worker');
    expect(result).not.toContain('Field 1');
    expect(result).toContain('Thumbnail removed · [Before](<https://example.com/old.png>)');
  });

  test('large multi-embed changes stay within the card budget and preserve the full transcript', () => {
    const embeds = Array.from(
      { length: 10 },
      () =>
        new Embed({
          description: 'D'.repeat(300),
          fields: Array.from({ length: 25 }, (_, i) => ({ name: `Skill ${i}`, value: 'V'.repeat(1024) }))
        })
    );
    const result = formatEmbedChanges([], embeds).join('\n');
    expect(result.length).toBeLessThan(3500);
    expect(result).toContain('Skill 0');
    expect(result).toContain('more embed changes in attachment');
    expect(formatEmbedEditTranscript([], embeds)).toContain('Skill 24');
  });

  test('unsupported media URL protocols never become clickable links', () => {
    const result = formatEmbedChanges([], [new Embed({ url: 'javascript:alert(1)' })]).join('\n');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('Unavailable');
  });
  test('long previews retain their full before and after evidence in a transcript', () => {
    const description = 'A'.repeat(330);
    const before = new Embed({ description });
    const after = new Embed({ description: 'Short update' });
    const transcript = formatEmbedEditTranscript([before], [after]);
    expect(transcript).not.toBeNull();
    expect(transcript).toContain(description);
    expect(transcript).toContain('Short update');
    expect(formatEmbedEditTranscript([], [new Embed({ description: 'Small embed' })])).toBeNull();
  });
  test('added embeds use a compact snapshot without pipe walls or repeated headings', () => {
    const embed = new Embed({
      title: 'Robbery failed',
      description: 'No items stolen',
      color: 0,
      thumbnail: { url: 'https://example.com/icon.png' }
    });
    const result = formatEmbedChanges([], [embed]).join('\n');
    expect(result).toContain('-# Embed added\n> **Robbery failed**\n> No items stolen');
    expect(result).toContain('Thumbnail added · [After](<https://example.com/icon.png>)');
    expect(result).toContain('#000000');
    expect(result).not.toContain('│');
    expect(result).not.toContain('Embed Changes');
  });

  test('updates show only changed values and label description before and after', () => {
    const before = new Embed({ title: 'Unchanged title', description: 'First description', color: 0 });
    const after = new Embed({ title: 'Unchanged title', description: 'Second description', color: 0xff0000 });
    const result = formatEmbedChanges([before], [after]).join('\n');
    expect(result).toContain('-# Embed updated');
    expect(result).toContain('**Before**\n> First description');
    expect(result).toContain('**After**\n> Second description');
    expect(result).toContain('-# Color: #000000 → #ff0000');
    expect(result).not.toContain('Unchanged title');
  });

  test('removed embeds retain a readable snapshot', () => {
    expect(formatEmbedChanges([new Embed({ title: 'Old embed' })], []).join('\n')).toContain(
      '-# Embed removed\n> **Old embed**'
    );
  });

  test('same-count field edits are detected and display their actual values', () => {
    const before = new Embed({ fields: [{ name: 'Balance', value: '10' }] });
    const after = new Embed({ fields: [{ name: 'Balance', value: '20' }] });
    expect(embedsAreDifferent([before], [after])).toBe(true);
    const result = formatEmbedChanges([before], [after]).join('\n');
    expect(result).toContain('**Before**\n> **Balance:** 10');
    expect(result).toContain('**After**\n> **Balance:** 20');
    expect(result).not.toContain('Field 1:');
  });

  test.each([
    [{ color: 0 }, { color: 1 }],
    [{ footer: { text: 'Old' } }, { footer: { text: 'New' } }],
    [
      { author: { name: 'Author', icon_url: 'https://example.com/old.png' } },
      { author: { name: 'Author', icon_url: 'https://example.com/new.png' } }
    ],
    [{ timestamp: '2026-01-01T00:00:00.000Z' }, { timestamp: '2026-01-02T00:00:00.000Z' }]
  ])('detects metadata-only changes', (before, after) => {
    const oldEmbed = new Embed(before);
    const newEmbed = new Embed(after);
    expect(embedsAreDifferent([oldEmbed], [newEmbed])).toBe(true);
    expect(formatEmbedChanges([oldEmbed], [newEmbed]).length).toBeGreaterThan(1);
  });

  test('ignores media proxy and dimension refreshes', () => {
    const before = new Embed({ image: { url: 'https://example.com/image.png', width: 100 } });
    const after = new Embed({
      image: { url: 'https://example.com/image.png', width: 200, proxy_url: 'https://example.com/proxy.png' }
    });
    expect(embedsAreDifferent([before], [after])).toBe(false);
    expect(formatEmbedChanges([before], [after])).toEqual([]);
  });

  test('escapes embedded headings and collapses multiline previews', () => {
    const result = formatEmbedChanges(
      [],
      [new Embed({ title: '**Injected title**', description: '### Heading\nsecond line' })]
    ).join('\n');
    expect(result).toContain('\\*\\*Injected title\\*\\*');
    expect(result).not.toContain('\nsecond line');
  });
});
