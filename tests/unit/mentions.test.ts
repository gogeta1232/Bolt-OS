import { Client, ContainerBuilder, MessagePayload, User } from 'discord.js';
import { describe, expect, test, vi } from 'vitest';

import { botConfig } from '../../src/config/bot.js';
import { v2 } from '../../src/lib/embeds.js';

const mentionText = '<@&123456789012345678> <@234567890123456789> @everyone @here';
const wirePolicy = { parse: [], users: [], roles: [], replied_user: false };
const recipient = (): User =>
  new User(new Client({ intents: [], allowedMentions: botConfig.clientOptions.allowedMentions }), {
    id: '345678901234567890',
    username: 'test'
  });

describe('command mention notifications', () => {
  test('the default sender keeps mention text while disabling every notification category', () => {
    const body = new MessagePayload(recipient(), { content: mentionText }).resolveBody().body;
    expect(body?.content).toBe(mentionText);
    expect(body?.allowed_mentions).toEqual(wirePolicy);
  });

  test('profile-style V2 cards retain role labels with no-ping metadata in the actual API payload', () => {
    const payload = v2({ title: 'User info', fields: [{ name: 'Roles', value: mentionText }] });
    // Use an unconfigured client to verify the card carries its own policy.
    const target = new User(new Client({ intents: [] }), { id: '345678901234567890', username: 'test' });
    const body = new MessagePayload(target, payload).resolveBody().body;
    expect(JSON.stringify(body?.components)).toContain(mentionText);
    expect(body?.allowed_mentions).toEqual(wirePolicy);
  });

  test('a fallback V2 card remains silent when normal card construction fails', () => {
    vi.spyOn(ContainerBuilder.prototype, 'setAccentColor').mockImplementationOnce(() => {
      throw new Error('test failure');
    });
    const body = new MessagePayload(recipient(), v2({ title: mentionText })).resolveBody().body;
    expect(JSON.stringify(body?.components)).toContain(mentionText);
    expect(body?.allowed_mentions).toEqual(wirePolicy);
    vi.restoreAllMocks();
  });

  test('an explicitly scoped greeting can still notify only its intended user', () => {
    const body = new MessagePayload(recipient(), {
      content: mentionText,
      allowedMentions: { parse: [], users: ['234567890123456789'] }
    }).resolveBody().body;
    expect(body?.allowed_mentions).toEqual({ parse: [], users: ['234567890123456789'] });
  });
});
