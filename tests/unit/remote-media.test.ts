import { describe, expect, test } from 'vitest';

import { isAllowedDiscordMediaUrl } from '../../src/lib/remote-media.js';

describe('Discord media URL validation', () => {
  test.each([
    'https://cdn.discordapp.com/attachments/1/2/image.png',
    'https://media.discordapp.net/attachments/1/2/image.webp'
  ])('allows trusted Discord HTTPS media: %s', (url) => {
    expect(isAllowedDiscordMediaUrl(url)).toBe(true);
  });

  test.each([
    'http://cdn.discordapp.com/attachments/1/2/image.png',
    'https://cdn.discordapp.com.evil.example/image.png',
    'https://127.0.0.1/private.png',
    'https://user:pass@cdn.discordapp.com/image.png',
    'not-a-url'
  ])('rejects unsafe media URLs: %s', (url) => {
    expect(isAllowedDiscordMediaUrl(url)).toBe(false);
  });
});
