import { describe, expect, test } from 'vitest';

import { getEmoji } from '../../src/config/emojis.js';
import { buildLogV2Container, type LogType } from '../../src/config/logging.js';

const logTypes = [
  'audit',
  'moderation',
  'administrative',
  'messageDelete',
  'messageEdit',
  'reaction',
  'memberJoin',
  'memberLeave',
  'memberUpdate',
  'channelCreate',
  'channelDelete',
  'channelUpdate',
  'channel',
  'emoji',
  'cases',
  'role',
  'guild',
  'voice'
] as const satisfies readonly LogType[];

const textBlocks = (result: ReturnType<typeof buildLogV2Container>): string[] =>
  result.components[0].toJSON().components.flatMap((component) => {
    if ('content' in component) return [component.content];
    if ('components' in component)
      return component.components.flatMap((child) => ('content' in child ? [child.content] : []));
    return [];
  });

describe('compact log layout', () => {
  test.each([
    [`${getEmoji('tag')} Nickname changed: \`Added\` → \`Removed 🟢\``, 'Nickname Changed'],
    [`${getEmoji('user')} Username: \`Added\` → \`Removed\``, 'Username Changed'],
    [`${getEmoji('globe')} Display name cleared: \`🟢 Added\` → \`Account\` (username)`, 'Display Name Changed']
  ])('name content does not misclassify the log header: %s', (description, title) => {
    const header = textBlocks(buildLogV2Container('memberUpdate', description))[0];
    expect(header).toContain(title);
    expect(header).not.toContain('Role Added');
    expect(header).not.toContain('Role Removed');
  });

  test('message edits retain repeated evidence and use the message ID with a footer Jump', () => {
    const url = 'https://discord.com/channels/111/222/333';
    const description = '**Embed 1 updated**\n**Title:** Old → New\n\n**Embed 2 updated**\n**Title:** Old → New';
    const blocks = textBlocks(
      buildLogV2Container('messageEdit', description, {
        channel: { id: '222' },
        message: { id: '333', url },
        timestamp: 1_700_000_000_000
      })
    );
    expect(blocks).toContain(description);
    expect(blocks.at(-1)).toBe(`-# ID \`333\` • [Jump](${url})`);
    expect(blocks[0]).toContain('<#222>');
  });
  test.each(logTypes)('%s uses a single small header without heading Markdown', (type) => {
    const result = buildLogV2Container(type, 'Sample event', { timestamp: 1_700_000_000_000 });
    const header = textBlocks(result)[0];
    expect(header).toMatch(/^-# /);
    expect(header).not.toContain('\n');
    expect(header).not.toMatch(/^#{1,3} /);
    expect(textBlocks(result)).toContain('Sample event');
    expect(
      result.components[0].toJSON().components.some((component) => component.type === 14 && component.divider)
    ).toBe(false);
  });

  test.each([
    ['reactionAdd', 'reactionAdd', 'Reaction added'],
    ['reactionRemove', 'reactionRemove', 'Reaction removed'],
    ['reactionClear', 'reactionRemove', 'Reactions cleared']
  ] as const)('reaction %s keeps the event icon, message ID and Jump without a thumbnail', (activity, icon, title) => {
    const url = 'https://discord.com/channels/111/222/333';
    const result = buildLogV2Container('reaction', "<@123> added 👍 to <@456>'s message", {
      activity,
      channel: { id: '222' },
      message: { id: '333', url },
      emojiIconUrl: 'https://cdn.discordapp.com/emojis/1545313026716999691.png',
      timestamp: 1_700_000_000_000
    });
    const blocks = textBlocks(result);
    expect(blocks[0]).toBe(`-# ${getEmoji(icon)} ${title} • <#222> • <t:1700000000:R>`);
    expect(blocks.at(-1)).toBe(`-# ID \`333\` • [Jump](${url})`);
    expect(result.components[0].toJSON().components.some((component) => component.type === 9)).toBe(false);
  });

  test('voice leave shows the channel once and keeps duration and member ID in one footer', () => {
    const result = buildLogV2Container('voice', '<@123> left <#222>', {
      activity: 'voiceLeave',
      channel: { id: '222' },
      subjectId: '123',
      duration: '12m 3s',
      timestamp: 1_700_000_000_000
    });
    const blocks = textBlocks(result);
    expect(blocks[0]).toBe(`-# ${getEmoji('voiceLeave')} Left voice • <t:1700000000:R>`);
    expect(blocks).toContain('<@123> left <#222>');
    expect(blocks.at(-1)).toBe('-# Duration 12m 3s • ID `123`');
    expect(blocks.join('\n').match(/<#222>/g)).toHaveLength(1);
    expect(blocks.join('\n').match(/12m 3s/g)).toHaveLength(1);
  });

  test('moderation still retains duration, reason and case details', () => {
    const result = buildLogV2Container('moderation', 'Member timed out', {
      duration: '10m',
      reason: 'Spam',
      caseId: 7
    });
    const body = textBlocks(result).join('\n');
    expect(body).toContain('**Duration:** 10m');
    expect(body).toContain('**Reason:** Spam');
    expect(body).toContain('**Case:** #7');
  });
});
