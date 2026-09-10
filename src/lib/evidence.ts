const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export const isImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((ext) => path.endsWith(`.${ext}`));
  } catch {
    return false;
  }
};

export const extractImageUrlsFromText = (text: string): string[] => {
  const urlRegex = /https?:\/\/[^\s<>()]+/gi;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  const out: string[] = [];
  for (const url of matches) {
    if (isImageUrl(url) && !out.includes(url)) out.push(url);
  }
  return out;
};

export const isImageAttachment = (att: { contentType?: string | null; name?: string | null; url: string }): boolean => {
  const ct = att.contentType?.toLowerCase() ?? '';
  const name = att.name?.toLowerCase() ?? '';
  const ext = name.split('.').pop() ?? '';
  if (ct.startsWith('video/')) {
    if (ext === 'gif') return true;
    return false;
  }
  if (ct.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(ext);
};

/**
 * Collect evidence URLs from reason text + message attachments + slash attachment.
 * Returns deduped array, unlimited in count but caller should slice if needed.
 * Only images/GIFs, no videos — matches AFK spec.
 */
export const collectEvidence = (opts: {
  reason?: string | null;
  attachments?:
    | Map<string, { url: string; contentType?: string | null; name?: string | null }>
    | { url: string; contentType?: string | null; name?: string | null }[]
    | null;
  slashAttachmentUrl?: string | null;
  slashAttachmentMeta?: { contentType?: string | null; name?: string | null } | null;
}): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (url: string) => {
    if (!url || seen.has(url)) return;
    if (!isImageUrl(url) && !url.startsWith('https://cdn.discordapp.com/')) return;
    // Also ensure not video
    if (url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov') || url.toLowerCase().endsWith('.webm'))
      return;
    seen.add(url);
    out.push(url);
  };

  if (opts.slashAttachmentUrl) {
    // Validate slash attachment is image
    const meta = opts.slashAttachmentMeta;
    if (!meta || isImageAttachment({ url: opts.slashAttachmentUrl, contentType: meta.contentType, name: meta.name })) {
      push(opts.slashAttachmentUrl);
    }
  }

  if (opts.attachments) {
    const list =
      opts.attachments instanceof Map
        ? [...opts.attachments.values()]
        : (opts.attachments as { url: string; contentType?: string | null; name?: string | null }[]);
    for (const att of list) {
      if (isImageAttachment(att)) push(att.url);
    }
  }

  if (opts.reason) {
    const urls = extractImageUrlsFromText(opts.reason);
    for (const u of urls) push(u);
  }

  return out;
};
