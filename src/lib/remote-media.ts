const ALLOWED_MEDIA_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2;

export interface DownloadedImage {
  data: Buffer;
  extension: string;
}

const parseAllowedUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!ALLOWED_MEDIA_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
};

export const isAllowedDiscordMediaUrl = (value: string): boolean => parseAllowedUrl(value) !== null;

const extensionFromUrl = (url: URL): string => {
  const extension = url.pathname.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension) ? extension : 'bin';
};

const readBodyWithLimit = async (response: Response, maxBytes: number): Promise<Buffer | null> => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel();
    return null;
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return receivedBytes > 0 ? Buffer.concat(chunks, receivedBytes) : null;
};

export const downloadDiscordImage = async (
  sourceUrl: string,
  options: { maxBytes: number; timeoutMs: number }
): Promise<DownloadedImage | null> => {
  let currentUrl = parseAllowedUrl(sourceUrl);
  if (!currentUrl) return null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { 'User-Agent': 'Bolt Discord Bot', Accept: 'image/*' }
    }).catch(() => null);
    if (!response) return null;

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirectCount === MAX_REDIRECTS) return null;
      currentUrl = parseAllowedUrl(new URL(location, currentUrl).toString());
      if (!currentUrl) return null;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (!contentType?.startsWith('image/')) {
      await response.body?.cancel();
      return null;
    }

    const data = await readBodyWithLimit(response, options.maxBytes);
    if (!data) return null;
    return { data, extension: extensionFromUrl(currentUrl) };
  }

  return null;
};
