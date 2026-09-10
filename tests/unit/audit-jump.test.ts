import { describe, expect, test } from 'vitest';

import {
  buildLogV2Container,
  buildModerationContext,
  resolveChannelContext,
  resolveMessageContext
} from '../../src/config/logging.js';

const stringifyContainer = (result: ReturnType<typeof buildLogV2Container>): string => {
  const container = result.components[0] as unknown as { toJSON: () => unknown };
  return JSON.stringify(container.toJSON());
};

describe('audit jump links use official Discord format', () => {
  test('resolveMessageContext preserves official message URL', () => {
    const guildId = '111';
    const channelId = '222';
    const messageId = '333';
    const url = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
    const ctx = resolveMessageContext({
      id: messageId,
      url,
      content: '!warn @user spam',
      createdTimestamp: 1_700_000_000_000
    } as never);
    expect(ctx?.id).toBe(messageId);
    expect(ctx?.url).toBe(url);
  });

  test('prefix audit log includes channel pill plus ID and Jump footer', () => {
    const messageId = '333';
    const channelId = '222';
    const url = `https://discord.com/channels/111/${channelId}/${messageId}`;
    const result = buildLogV2Container('audit', '`/warn` used', {
      actor: { id: '1', tag: 'mod#1' } as never,
      channel: { id: channelId, name: 'mod-commands' },
      message: { id: messageId, url },
      timestamp: Date.now(),
      hideDetailsSection: true
    });
    const json = stringifyContainer(result);
    expect(json).toContain(`<#${channelId}>`);
    expect(json).toContain(messageId);
    expect(json).toContain(`[Jump](${url})`);
  });

  test('slash audit log stays channel-only with no Jump link', () => {
    const result = buildLogV2Container('audit', '`/warn` used', {
      actor: { id: '1', tag: 'mod#1' } as never,
      channel: { id: '222' },
      timestamp: Date.now(),
      hideDetailsSection: true
    });
    const json = stringifyContainer(result);
    expect(json).toContain('<#222>');
    expect(json).not.toContain('Jump');
  });

  test('resolveChannelContext keeps id for header pill', () => {
    const ctx = resolveChannelContext({ id: '222', name: 'staff' } as never);
    expect(ctx?.id).toBe('222');
  });
});

describe('channel pill cleanup for non-message moderation logs', () => {
  test('warn-style moderation context omits channel', () => {
    const ctx = buildModerationContext({
      actor: { id: '1', tag: 'mod' } as never,
      target: { id: '2', tag: 'user' } as never,
      reason: 'spam',
      caseId: 7
    });
    expect(ctx.channel).toBeFalsy();
  });

  test('moderation V2 without channel has no channel mention', () => {
    const ctx = buildModerationContext({
      actor: { id: '1', tag: 'mod' } as never,
      target: { id: '2', tag: 'user' } as never,
      reason: 'spam',
      caseId: 7
    });
    const result = buildLogV2Container('moderation', 'Case #7', ctx);
    expect(stringifyContainer(result)).not.toContain('<#');
  });

  test('message logs keep channel pill when a message is indicated', () => {
    const result = buildLogV2Container('messageDelete', '**Content:** hello', {
      target: { id: '2', tag: 'user' } as never,
      channel: { id: '222', name: 'general' },
      message: { id: '333', url: 'https://discord.com/channels/111/222/333' },
      timestamp: Date.now(),
      hideDetailsSection: true
    });
    expect(stringifyContainer(result)).toContain('<#222>');
  });
});
