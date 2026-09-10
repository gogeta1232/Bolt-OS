import { describe, expect, test } from 'vitest';

import { buildWarnConfirmationContainer, formatWarnDuration } from '../../src/lib/warn-views.js';

const stringifyContainer = (container: ReturnType<typeof buildWarnConfirmationContainer>): string =>
  JSON.stringify((container as unknown as { toJSON: () => unknown }).toJSON());

describe('warn confirmation stays ultra-minimal and sleek', () => {
  test('small header with case and duration, plain username and ID footer', () => {
    const json = stringifyContainer(
      buildWarnConfirmationContainer({
        caseId: 41,
        username: 'amreign.',
        userId: '123456789012345678',
        durationLabel: null,
        reason: 'spam reason',
        evidence: []
      })
    );
    expect(json).toContain('Case #41');
    expect(json).toContain('Permanent');
    expect(json).toContain('spam reason');
    expect(json).toContain('amreign.');
    expect(json).toContain('123456789012345678');
  });

  test('omits guild line, avatar, member/moderator mentions and big heading', () => {
    const json = stringifyContainer(
      buildWarnConfirmationContainer({
        caseId: 41,
        username: 'amreign.',
        userId: '123456789012345678',
        durationLabel: null,
        reason: 'spam',
        evidence: []
      })
    );
    expect(json).not.toContain('##');
    expect(json).not.toContain('Warning Issued');
    expect(json).not.toContain('Member');
    expect(json).not.toContain('Moderator');
    expect(json).not.toContain('<@');
    expect(json).not.toContain('thumbnail');
  });

  test('case appears once in header, footer carries ID without repeating case', () => {
    const json = stringifyContainer(
      buildWarnConfirmationContainer({
        caseId: 41,
        username: 'amreign.',
        userId: '123456789012345678',
        durationLabel: '3 days',
        reason: 'spam',
        evidence: []
      })
    );
    expect(json.match(/Case #41/g)?.length).toBe(1);
    expect(json).toContain('3 days');
    expect(json).toContain('ID');
  });

  test('temporary duration uses cool Discord timestamp markdown', () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const unix = Math.floor(expiresAt.getTime() / 1000);
    const json = stringifyContainer(
      buildWarnConfirmationContainer({
        caseId: 42,
        username: 'amreign.',
        userId: '123456789012345678',
        durationLabel: '1 minute',
        expiresAt,
        reason: 'spam',
        evidence: []
      })
    );
    expect(json).toContain('1 minute');
    expect(json).toContain(`<t:${unix}:R>`);
  });

  test('formatWarnDuration falls back cleanly without expiry', () => {
    expect(formatWarnDuration(null, null)).toBe('Permanent');
    expect(formatWarnDuration('1 minute', null)).toBe('1 minute');
  });

  test('evidence renders as separate block when present', () => {
    const json = stringifyContainer(
      buildWarnConfirmationContainer({
        caseId: 7,
        username: 'user',
        userId: '1',
        durationLabel: null,
        reason: 'spam',
        evidence: ['https://cdn.discordapp.com/x.png']
      })
    );
    expect(json).toContain('https://cdn.discordapp.com/x.png');
  });

  test('bounds large evidence lists to Discord text component limits', () => {
    const evidence = Array.from(
      { length: 10 },
      (_, index) => `https://cdn.discordapp.com/${index}/${'a'.repeat(450)}.png`
    );

    expect(() =>
      buildWarnConfirmationContainer({
        caseId: 8,
        username: 'user',
        userId: '1',
        reason: 'spam',
        evidence
      }).toJSON()
    ).not.toThrow();
  });
});
