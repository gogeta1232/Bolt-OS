import { afterEach, describe, expect, test, vi } from 'vitest';

import { downloadDiscordImage, isAllowedDiscordMediaUrl } from '../../src/lib/remote-media.js';

afterEach(() => vi.unstubAllGlobals());

describe('bounded Discord image downloads', () => {
  const url = 'https://cdn.discordapp.com/attachments/1/2/no-extension';
  const options = { maxBytes: 10, timeoutMs: 1000 };

  test('uses the response image type for extensionless and misleading filenames', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } }))
    );
    expect(await downloadDiscordImage(url, options)).toEqual({ data: Buffer.from('image'), extension: 'png' });
  });

  test('returns null on a failed body read instead of aborting the caller', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      }
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } })));
    await expect(downloadDiscordImage(url, options)).resolves.toBeNull();
  });

  test('enforces the streaming byte limit without a content-length header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('too many bytes', { headers: { 'content-type': 'image/png' } }))
    );
    expect(await downloadDiscordImage(url, options)).toBeNull();
  });

  test.each(['https://evil.example/image.png', 'http://[invalid'])(
    'rejects unsafe or malformed redirects: %s',
    async (location) => {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      vi.stubGlobal('fetch', fetch);
      await expect(downloadDiscordImage(url, options)).resolves.toBeNull();
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  test('does not accept non-image response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('html', { headers: { 'content-type': 'text/html' } }))
    );
    expect(await downloadDiscordImage(url, options)).toBeNull();
  });
});

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
