import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

import { getEmoji } from '../../../config/emojis.js';

const MAX_ROLES_SHOWN = 6;
const AVATAR_SIZE = 1024;
const ROLE_CACHE_MAX = 2000;
const AVATAR_CACHE_MAX = 2000;
const NICK_CACHE_MAX = 2000;

// Caches to avoid false positives from partial / stale oldMember
const roleCache = new Map<string, Set<string>>();
const guildAvatarCache = new Map<string, string | null>();
const nickCache = new Map<string, string | null>();

const code = (v: string | null | undefined, fallback = '*none*'): string => {
  if (!v) return fallback;
  const clean = v.replace(/`/g, "'").slice(0, 32);
  return `\`${clean}\``;
};

/**
 * Resolves visible nicknames for logging — clearing server nick shows universal display, never empty.
 * WHY exported pure: Discord sets nickname=null on clear while displayName falls back to globalName ?? username.
 */
export const resolveNickDisplay = (
  prevNick: string | null,
  currNick: string | null,
  oldDisplay: string,
  newDisplay: string
): { oldShown: string; newShown: string } => ({
  oldShown: prevNick ?? oldDisplay,
  newShown: currNick ?? newDisplay
});

export const formatNickChange = (
  prevNick: string | null,
  currNick: string | null,
  oldDisplay: string,
  newDisplay: string
): string => {
  const { oldShown, newShown } = resolveNickDisplay(prevNick, currNick, oldDisplay, newDisplay);
  return `${getEmoji('tag')} ${code(oldShown)} → ${code(newShown)}`;
};

export const resolveNickChange = (
  cachedNick: string | null | undefined,
  oldNick: string | null,
  newNick: string | null,
  oldDisplay: string,
  newDisplay: string
): string | null => {
  const previousNick = cachedNick === undefined ? oldNick : cachedNick;
  if (previousNick === newNick) return null;
  return formatNickChange(previousNick, newNick, oldDisplay, newDisplay);
};

const rememberRole = (key: string, roles: Set<string>): void => {
  roleCache.set(key, roles);
  if (roleCache.size > ROLE_CACHE_MAX) {
    const first = roleCache.keys().next().value;
    if (first) roleCache.delete(first);
  }
};

const rememberGuildAvatar = (key: string, hash: string | null): void => {
  guildAvatarCache.set(key, hash);
  if (guildAvatarCache.size > AVATAR_CACHE_MAX) {
    const first = guildAvatarCache.keys().next().value;
    if (first) guildAvatarCache.delete(first);
  }
};

const rememberNick = (key: string, nick: string | null): void => {
  nickCache.set(key, nick);
  if (nickCache.size > NICK_CACHE_MAX) {
    const first = nickCache.keys().next().value;
    if (first) nickCache.delete(first);
  }
};

const DEDUP_TTL_MS = 10_000;
const recentMemberLogs = new Map<string, { body: string; galleryKey: string; at: number }>();

export class GuildMemberUpdateListener extends Listener<typeof Events.GuildMemberUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberUpdate });
  }

  public async run(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    if (
      oldMember.nickname !== newMember.nickname ||
      oldMember.displayName !== newMember.displayName ||
      oldMember.user.username !== newMember.user.username ||
      oldMember.user.globalName !== newMember.user.globalName
    ) {
      this.container.memberResolver.invalidateGuild(newMember.guild.id);
    }
    const { description, galleryUrls } = await this.buildUpdatePayload(oldMember, newMember);
    if (!description && galleryUrls.length === 0) return;

    // Debounce identical payloads (Discord can fire GuildMemberUpdate 2-3 times for same avatar/nick)
    const cacheKey = `${newMember.guild.id}:${newMember.id}`;
    const dedupedGallery = [...new Set(galleryUrls)].slice(0, 10);
    const galleryKey = dedupedGallery.join('|');
    const recent = recentMemberLogs.get(cacheKey);
    if (
      recent &&
      Date.now() - recent.at < DEDUP_TTL_MS &&
      recent.body === description &&
      recent.galleryKey === galleryKey
    ) {
      return;
    }
    recentMemberLogs.set(cacheKey, { body: description, galleryKey, at: Date.now() });
    if (recentMemberLogs.size > 2000) {
      const first = recentMemberLogs.keys().next().value;
      if (first) recentMemberLogs.delete(first);
    }

    await this.container.logging.sendMemberUpdateLog(newMember.guild, description || 'Member profile updated', {
      target: newMember.user,
      showTargetAvatar: true,
      timestamp: Date.now(),
      galleryUrls: dedupedGallery.length ? dedupedGallery : undefined
    });
  }

  private async buildUpdatePayload(
    oldMember: GuildMember,
    newMember: GuildMember
  ): Promise<{ description: string; galleryUrls: string[] }> {
    const lines: string[] = [];
    const galleryUrls: string[] = [];
    const cacheKey = `${newMember.guild.id}:${newMember.id}`;

    // ── Nickname — cache-backed to avoid false "none → X" on first sight ──
    // WHY display fallback: clearing server nick sets nickname=null but Discord shows
    // universal nickname (globalName ?? username) via displayName — never show "*none*" or empty.
    const prevNick = nickCache.get(cacheKey);
    const currNick = newMember.nickname ?? null;
    const nickChange = resolveNickChange(
      prevNick,
      oldMember.nickname ?? null,
      currNick,
      oldMember.displayName,
      newMember.displayName
    );
    if (nickChange) lines.push(nickChange);
    // Handle displayName fallback only if nick didn't change and we have cached nick
    if (lines.length === 0 && prevNick !== undefined && oldMember.displayName !== newMember.displayName) {
      // Only log displayName if昵称 didn't change and it's a real change
      if (oldMember.nickname === newMember.nickname) {
        // Check if it's actually globalName change (handled via UserUpdate) — but still log if guild display different
        // To avoid duplicate with UserUpdate, only log if prevNick is not null (member had nick)
        // For now, keep simple: log displayName change as nick
        lines.push(`${getEmoji('tag')} ${code(oldMember.displayName)} → ${code(newMember.displayName)}`);
      }
    }
    rememberNick(cacheKey, currNick);

    // ── Server avatar (guild-specific only) — global avatar/banner handled via UserUpdate ──
    const prevGuildAvatar = guildAvatarCache.get(cacheKey);
    const currGuildAvatar = newMember.avatar ?? null;
    const guildAvatarChanged =
      prevGuildAvatar !== undefined ? prevGuildAvatar !== currGuildAvatar : oldMember.avatar !== newMember.avatar;
    if (guildAvatarChanged) {
      const shouldLog = prevGuildAvatar !== undefined;
      if (shouldLog) {
        const beforeUrl = oldMember.displayAvatarURL({ size: AVATAR_SIZE, forceStatic: false, extension: 'png' });
        const afterUrl = newMember.displayAvatarURL({ size: AVATAR_SIZE, forceStatic: false, extension: 'png' });
        if (beforeUrl !== afterUrl) {
          if (!galleryUrls.includes(beforeUrl)) galleryUrls.push(beforeUrl);
          if (!galleryUrls.includes(afterUrl)) galleryUrls.push(afterUrl);
        }
        if (!prevGuildAvatar && currGuildAvatar) lines.push(`${getEmoji('avatar')} Server avatar added`);
        else if (prevGuildAvatar && !currGuildAvatar) lines.push(`${getEmoji('avatar')} Server avatar cleared`);
        else lines.push(`${getEmoji('avatar')} Server avatar updated`);
      }
    }
    rememberGuildAvatar(cacheKey, currGuildAvatar);

    // ── Roles — robust, cache-backed to avoid pfp-triggered false positives ──
    const roleLines = this.buildRoleLines(newMember);
    lines.push(...roleLines);

    // ── Timeout ──
    const timeoutLine = this.buildTimeoutLine(oldMember, newMember);
    if (timeoutLine) lines.push(timeoutLine);

    // ── Boost ──
    if (!oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp) {
      lines.push(`${getEmoji('boost')} Boosting`);
    } else if (oldMember.premiumSinceTimestamp && !newMember.premiumSinceTimestamp) {
      lines.push(`${getEmoji('boost')} Boost stopped`);
    }

    // ── Screening ──
    if (oldMember.pending && !newMember.pending) {
      lines.push(`${getEmoji('verified')} Verified`);
    } else if (!oldMember.pending && newMember.pending) {
      lines.push(`${getEmoji('pending')} Pending verification`);
    }

    const dedupedGallery = [...new Set(galleryUrls)].slice(0, 10);
    // Deduplicate identical lines (e.g. avatar updated appearing twice if both nick and displayName fire)
    const dedupedLines = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
    return { description: dedupedLines.join('\n'), galleryUrls: dedupedGallery };
  }

  private buildRoleLines(newMember: GuildMember): string[] {
    const everyoneId = newMember.guild.roles.everyone.id;
    const cacheKey = `${newMember.guild.id}:${newMember.id}`;

    const currRoleIds = new Set(
      [...newMember.roles.cache.values()].filter((r) => r.id !== everyoneId).map((r) => r.id)
    );
    const prevCached = roleCache.get(cacheKey);

    // First sight: prime cache and never log (prevents "already had roles" false positive)
    if (prevCached === undefined) {
      rememberRole(cacheKey, currRoleIds);
      return [];
    }

    const oldRoleIds = prevCached;

    // If sets are equal, no change — avoids false positive when only pfp changed
    if (oldRoleIds.size === currRoleIds.size && [...oldRoleIds].every((id) => currRoleIds.has(id))) {
      return [];
    }

    const addedIds = [...currRoleIds].filter((id) => !oldRoleIds.has(id));
    const removedIds = [...oldRoleIds].filter((id) => !currRoleIds.has(id));

    // Update cache now
    rememberRole(cacheKey, currRoleIds);

    if (addedIds.length === 0 && removedIds.length === 0) return [];

    const lines: string[] = [];
    if (addedIds.length > 0) {
      const shown = addedIds
        .slice(0, MAX_ROLES_SHOWN)
        .map((id) => `<@&${id}>`)
        .join(' ');
      const overflow = addedIds.length > MAX_ROLES_SHOWN ? ` *+${addedIds.length - MAX_ROLES_SHOWN} more*` : '';
      lines.push(`${getEmoji('dotGreen')} ${shown}${overflow}`);
    }
    if (removedIds.length > 0) {
      const shown = removedIds
        .slice(0, MAX_ROLES_SHOWN)
        .map((id) => `<@&${id}>`)
        .join(' ');
      const overflow = removedIds.length > MAX_ROLES_SHOWN ? ` *+${removedIds.length - MAX_ROLES_SHOWN} more*` : '';
      lines.push(`${getEmoji('dotRed')} ${shown}${overflow}`);
    }
    return lines;
  }

  private buildTimeoutLine(oldMember: GuildMember, newMember: GuildMember): string | null {
    const before = oldMember.communicationDisabledUntilTimestamp;
    const after = newMember.communicationDisabledUntilTimestamp;
    if (before === after) return null;

    const now = Date.now();
    const beforeActive = before !== null && before > now;
    const afterActive = after !== null && after > now;

    // No state change (both active/inactive) — ignore, even if timestamps differ in the past
    if (beforeActive === afterActive) {
      // If both active but time extended/ shortened, still log
      if (beforeActive && afterActive && before !== after) {
        return `${getEmoji('timeoutIcon')} Timeout until <t:${Math.floor(after / 1000)}:F> (<t:${Math.floor(after / 1000)}:R>)`;
      }
      return null;
    }
    if (afterActive && !beforeActive) {
      return `${getEmoji('timeoutIcon')} Timeout until <t:${Math.floor(after / 1000)}:F> (<t:${Math.floor(after / 1000)}:R>)`;
    }
    return `${getEmoji('timeoutIcon')} Timeout removed`;
  }
}
