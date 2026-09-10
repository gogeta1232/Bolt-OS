/**
 * Shared emoji matching utilities for reactions
 */

interface EmojiData {
  name?: string;
  id?: string;
}

/**
 * Check if two emojis match
 */
export function emojisMatch(emoji1: EmojiData, emoji2String: string): boolean {
  // Unicode emoji
  if (emoji1.name && !emoji1.id && emoji1.name === emoji2String) {
    return true;
  }

  // Custom emoji
  if (emoji1.id) {
    const formats = [`<a:${emoji1.name}:${emoji1.id}>`, `<:${emoji1.name}:${emoji1.id}>`];
    return formats.includes(emoji2String);
  }

  return false;
}

/**
 * Get emoji string from reaction emoji
 */
export function getEmojiString(emoji: EmojiData): string {
  return emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name || '';
}

/**
 * Parse duration string to milliseconds
 */
export function parseDuration(duration: string): number | null {
  const regex = /(\d+)([smhd])/g;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(duration)) !== null) {
    const valueText = match[1];
    const unit = match[2];
    if (!valueText || !unit) continue;
    const value = parseInt(valueText, 10);

    switch (unit) {
      case 's':
        totalMs += value * 1000;
        break;
      case 'm':
        totalMs += value * 60 * 1000;
        break;
      case 'h':
        totalMs += value * 60 * 60 * 1000;
        break;
      case 'd':
        totalMs += value * 24 * 60 * 60 * 1000;
        break;
    }
  }

  return totalMs > 0 ? totalMs : null;
}

/**
 * Format duration from milliseconds
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
