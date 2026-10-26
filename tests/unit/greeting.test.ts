import { describe, expect, test } from 'vitest';

import { GuildConfigModel } from '../../src/database/models/guild/GuildConfig.js';
import { MAX_GREET_DURATION_MS, parseGreetDuration, resolveGreetDuration } from '../../src/lib/greeting.js';

describe('greeting duration', () => {
  test.each([
    ['1s', 1_000],
    ['30 seconds', 30_000],
    ['5m', 300_000],
    ['5 minutes', 300_000],
    ['2 hours', 7_200_000],
    ['1 day', 86_400_000],
    ['1d 2h', 93_600_000],
    ['365d', MAX_GREET_DURATION_MS]
  ])('accepts %s', (input, milliseconds) => {
    expect(parseGreetDuration(input)?.milliseconds).toBe(milliseconds);
  });

  test.each(['', '0s', '-1s', '1.5s', 'forever', '5', '2h later', '366d'])('rejects %s', (input) => {
    expect(parseGreetDuration(input)).toBeNull();
  });

  test.each([undefined, null, 0, -1, 1.5, NaN, Infinity, '5m', MAX_GREET_DURATION_MS + 1])(
    'falls back to two seconds for invalid or missing stored duration %s',
    (input) => {
      expect(resolveGreetDuration(input)).toBe(2_000);
    }
  );

  test('schema defaults to two seconds and rejects out-of-range durations', async () => {
    expect(new GuildConfigModel({ guildId: 'guild' }).greetDurationMs).toBe(2_000);
    for (const greetDurationMs of [0, -1, 1.5, MAX_GREET_DURATION_MS + 1]) {
      await expect(new GuildConfigModel({ guildId: 'guild', greetDurationMs }).validate()).rejects.toHaveProperty(
        'errors.greetDurationMs'
      );
    }
  });

  test('legacy permanent welcome settings are no longer part of the schema', () => {
    expect(GuildConfigModel.schema.path('welcome.channelId')).toBeUndefined();
    expect(GuildConfigModel.schema.path('welcome.message')).toBeUndefined();
  });
});
