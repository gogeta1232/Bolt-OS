import { Events, Listener } from '@sapphire/framework';
import type { User } from 'discord.js';

import { getEmoji } from '../config/emojis.js';

const BANNER_CACHE_MAX = 2000;

/** Last-seen banner hashes — WHY: the gateway rarely includes banner, so diff via one fetch + cache. */
const bannerCache = new Map<string, string | null>();

const rememberBanner = (userId: string, banner: string | null): void => {
  bannerCache.set(userId, banner);
  if (bannerCache.size > BANNER_CACHE_MAX) {
    const first = bannerCache.keys().next().value;
    if (first) bannerCache.delete(first);
  }
};

const DEDUP_TTL_MS = 10_000;
const recentLogs = new Map<string, { body: string; galleryKey: string; at: number }>();

export class UserUpdateListener extends Listener<typeof Events.UserUpdate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.UserUpdate });
  }

  public override async run(oldUser: User, newUser: User) {
    try {
      // Bots previously skipped — now handled (pfp/banner changes for bots need logging too)
      // No early return; bot avatar/banner changes are valid member logs.

      const lines: string[] = [];
      const galleryUrls: string[] = [];

      const code = (v: string | null | undefined): string => {
        if (!v) return '*none*';
        return `\`${v.replace(/`/g, "'").slice(0, 32)}\``;
      };

      if (oldUser.username !== newUser.username) {
        lines.push(`${getEmoji('user')} ${code(oldUser.username)} → ${code(newUser.username)}`);
      }

      const oldGlobal = (oldUser as unknown as { globalName?: string | null }).globalName ?? null;
      const newGlobal = (newUser as unknown as { globalName?: string | null }).globalName ?? null;
      if (oldGlobal !== newGlobal) {
        lines.push(`${getEmoji('globe')} ${code(oldGlobal)} → ${code(newGlobal)}`);
      }

      if (oldUser.avatar !== newUser.avatar) {
        const beforeUrl = oldUser.displayAvatarURL({ size: 1024, forceStatic: false, extension: 'png' });
        const afterUrl = newUser.displayAvatarURL({ size: 1024, forceStatic: false, extension: 'png' });
        lines.push(`${getEmoji('avatar')} Avatar updated`);
        galleryUrls.push(beforeUrl, afterUrl);
      }

      // Banner: fetch once (hash isn't on the event payload), compare with cache.
      // WHY seed-silent: first sight only primes the cache to avoid false positives.
      let bannerLine: string | null = null;
      let bannerBeforeUrl: string | null = null;
      let bannerAfterUrl: string | null = null;
      try {
        const fresh = await newUser.fetch();
        const seen = bannerCache.get(newUser.id);
        const changed = seen !== undefined && seen !== fresh.banner;
        if (changed) {
          if (fresh.banner) {
            bannerLine = `${getEmoji('banner')} Banner updated`;
            bannerAfterUrl = fresh.bannerURL?.({ size: 1024 }) ?? null;
            try {
              bannerBeforeUrl = oldUser.bannerURL?.({ size: 1024 }) ?? null;
            } catch {
              bannerBeforeUrl = null;
            }
          } else {
            bannerLine = `${getEmoji('banner')} Banner removed`;
            try {
              bannerBeforeUrl = oldUser.bannerURL?.({ size: 1024 }) ?? null;
            } catch {
              bannerBeforeUrl = null;
            }
          }
          if (bannerBeforeUrl) galleryUrls.push(bannerBeforeUrl);
          if (bannerAfterUrl) galleryUrls.push(bannerAfterUrl);
        }
        // Also handle "added" case where seen was null and now has banner but we suppressed above?
        // If seen === null and fresh.banner !== null, that's an add — still log (seen !== undefined covers it)
        // First sight (seen === undefined) is silent — only primes cache.
        rememberBanner(newUser.id, fresh.banner ?? null);
        if (bannerLine) lines.push(bannerLine);
      } catch {
        // Banner check is best-effort — username/avatar diffs still log.
      }

      if (lines.length === 0) return;

      // Deduplicate identical lines (prevents "Avatar updated" appearing 2-3 times if event fires twice)
      const uniqueLines = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
      if (uniqueLines.length === 0) return;
      const body = uniqueLines.join('\n');
      const dedupedGallery = [...new Set(galleryUrls)].slice(0, 10);
      const galleryKey = dedupedGallery.join('|');

      // Debounce identical payloads for same user (Discord can emit UserUpdate 2-3 times rapidly)
      const recent = recentLogs.get(newUser.id);
      if (recent && Date.now() - recent.at < DEDUP_TTL_MS && recent.body === body && recent.galleryKey === galleryKey) {
        return;
      }
      recentLogs.set(newUser.id, { body, galleryKey, at: Date.now() });
      if (recentLogs.size > 1000) {
        const first = recentLogs.keys().next().value;
        if (first) recentLogs.delete(first);
      }

      // Fan out to every mutual guild (dispatch drops guilds with no log channel).
      const sends: Promise<unknown>[] = [];
      for (const guild of this.container.client.guilds.cache.values()) {
        if (!guild.members.cache.has(newUser.id)) continue;
        if (oldUser.username !== newUser.username || oldGlobal !== newGlobal) {
          this.container.memberResolver.invalidateGuild(guild.id);
        }
        sends.push(
          this.container.logging
            .sendMemberUpdateLog(guild, body, {
              target: newUser,
              showTargetAvatar: true,
              timestamp: Date.now(),
              galleryUrls: dedupedGallery.length ? dedupedGallery : undefined
            })
            .catch(() => undefined)
        );
      }
      await Promise.all(sends);
    } catch (error) {
      this.container.logger.debug({ err: error, userId: newUser.id }, 'User update log failed');
    }
  }
}
