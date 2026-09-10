import Fuse from 'fuse.js';
import type { Collection, Guild, GuildMember, Message } from 'discord.js';

export interface ResolutionResult {
  readonly member: GuildMember | null;
  readonly consumed: number;
  readonly confidence: number | null;
  readonly reason?: 'ambiguous' | 'not_found';
  readonly feedback?: string;
}

interface SearchCandidate {
  readonly raw: string;
  readonly normalized: string;
  readonly consumed: number;
}

interface FuseEntry {
  readonly member: GuildMember;
  readonly username: string;
  readonly displayName: string;
  readonly globalName: string;
  readonly nickname: string;
}

interface GuildSearchIndex {
  readonly members: GuildMember[];
  readonly exact: ReadonlyMap<string, readonly GuildMember[]>;
  readonly fuse: Fuse<FuseEntry>;
  readonly sourceSize: number;
  readonly expiresAt: number;
}

interface TokenCacheEntry {
  readonly signature: string;
  readonly tokens: ReadonlySet<string>;
}

const MAX_INDEXED_MEMBERS = 5_000;
const MAX_GUILD_INDEXES = 20;
const INDEX_TTL_MS = 60_000;
const MAX_SCORE = 0.3;
const MIN_SCORE_DIFFERENCE = 0.08;
const MAX_CANDIDATE_DISPLAY = 5;
const MAX_INPUT_TOKENS = 12;
const MAX_NAME_LENGTH = 64;
const MAX_REMOTE_QUERIES = 3;
const REMOTE_SEARCH_LIMIT = 25;
const REMOTE_CACHE_TTL_MS = 30_000;
const MAX_REMOTE_CACHE_ENTRIES = 500;
const MAX_IN_FLIGHT_SEARCHES = 100;
const MIN_FUZZY_QUERY_LENGTH = 2;
const MEMBER_ID_PATTERN = /^[0-9]{17,20}$/;
const MEMBER_MENTION_PATTERN = /^<@!?([0-9]{17,20})>$/;

export class MemberResolver {
  private readonly tokenCache = new WeakMap<GuildMember, TokenCacheEntry>();
  private readonly guildIndexes = new Map<string, GuildSearchIndex>();
  private readonly remoteSearchCache = new Map<string, { members: GuildMember[]; expiresAt: number }>();
  private readonly inFlightSearches = new Map<string, Promise<GuildMember[] | null>>();

  public async resolve(message: Message, tokens: readonly string[]): Promise<ResolutionResult> {
    const guild = message.guild;
    if (!guild || tokens.length === 0) return this.createNotFoundResult();

    const inputTokens = tokens.slice(0, MAX_INPUT_TOKENS);
    const mentionResult = await this.tryResolveMention(guild, inputTokens[0]);
    if (mentionResult) return mentionResult;

    const idResult = await this.tryResolveById(guild, inputTokens[0]);
    if (idResult) return idResult;

    const candidates = this.createSearchCandidates(inputTokens);
    if (candidates.length === 0) return this.createNotFoundResult();

    const index = this.getOrCreateGuildIndex(guild);
    const localResult = this.matchCandidates(index.members, candidates, index.exact, index.fuse);
    if (localResult) return localResult;

    const remoteMembers = await this.searchRemoteMembers(guild, inputTokens);
    if (remoteMembers.length === 0) return this.createNotFoundResult();

    const remoteIndex = this.buildSearchIndex(remoteMembers, remoteMembers.length);
    return (
      this.matchCandidates(remoteIndex.members, candidates, remoteIndex.exact, remoteIndex.fuse) ??
      this.createNotFoundResult()
    );
  }

  public invalidateGuild(guildId: string): void {
    this.guildIndexes.delete(guildId);
    const prefix = `${guildId}:`;
    for (const key of this.remoteSearchCache.keys()) {
      if (key.startsWith(prefix)) this.remoteSearchCache.delete(key);
    }
  }

  public clear(): void {
    this.guildIndexes.clear();
    this.remoteSearchCache.clear();
    this.inFlightSearches.clear();
  }

  private async tryResolveMention(guild: Guild, firstToken: string | undefined): Promise<ResolutionResult | null> {
    if (!firstToken) return null;
    const memberId = MEMBER_MENTION_PATTERN.exec(firstToken)?.[1];
    if (!memberId) return null;

    const member = guild.members.cache.get(memberId) ?? (await guild.members.fetch(memberId).catch(() => null));
    return member ? { member, consumed: 1, confidence: 0 } : this.createNotFoundResult();
  }

  private async tryResolveById(guild: Guild, firstToken: string | undefined): Promise<ResolutionResult | null> {
    if (!firstToken || !MEMBER_ID_PATTERN.test(firstToken)) return null;
    const member = guild.members.cache.get(firstToken) ?? (await guild.members.fetch(firstToken).catch(() => null));
    return member ? { member, consumed: 1, confidence: 0 } : this.createNotFoundResult();
  }

  private createSearchCandidates(tokens: readonly string[]): SearchCandidate[] {
    const candidates: SearchCandidate[] = [];
    const seen = new Set<string>();

    for (let consumed = tokens.length; consumed >= 1; consumed -= 1) {
      const raw = tokens.slice(0, consumed).join(' ').trim();
      const normalized = this.normalizeTerm(raw);
      if (!normalized || normalized.length > MAX_NAME_LENGTH || seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push({ raw, normalized, consumed });
    }

    return candidates;
  }

  private matchCandidates(
    members: readonly GuildMember[],
    candidates: readonly SearchCandidate[],
    exactIndex: ReadonlyMap<string, readonly GuildMember[]>,
    fuse: Fuse<FuseEntry>
  ): ResolutionResult | null {
    for (const candidate of candidates) {
      const indexed = exactIndex.get(candidate.normalized) ?? [];
      const matches = indexed.filter((member) => this.getMemberTokens(member).has(candidate.normalized));
      const result = this.createMatchResult(candidate, matches, 0);
      if (result) return result;
    }

    for (const candidate of candidates) {
      const matches = this.collectMatches(members, (alias) => alias.startsWith(candidate.normalized));
      const result = this.createMatchResult(candidate, matches, 0.05);
      if (result) return result;
    }

    for (const candidate of candidates) {
      if (candidate.normalized.length < MIN_FUZZY_QUERY_LENGTH) continue;
      const matches = this.collectMatches(members, (alias) => alias.includes(candidate.normalized));
      const result = this.createMatchResult(candidate, matches, 0.1);
      if (result) return result;
    }

    for (const candidate of candidates) {
      if (candidate.normalized.length < MIN_FUZZY_QUERY_LENGTH) continue;
      const result = this.searchWithFuse(fuse, candidate);
      if (result) return result;
    }

    return null;
  }

  private createMatchResult(
    candidate: SearchCandidate,
    matches: readonly GuildMember[],
    confidence: number
  ): ResolutionResult | null {
    if (matches.length === 1) {
      return { member: matches[0] ?? null, consumed: candidate.consumed, confidence };
    }
    if (matches.length > 1) return this.createAmbiguousResult(candidate.raw, matches, candidate.consumed);
    return null;
  }

  private collectMatches(
    members: readonly GuildMember[],
    predicate: (normalizedAlias: string) => boolean
  ): GuildMember[] {
    const matched: GuildMember[] = [];
    for (const member of members) {
      let isMatch = false;
      for (const alias of this.getMemberTokens(member)) {
        if (!predicate(alias)) continue;
        isMatch = true;
        break;
      }
      if (!isMatch) continue;
      matched.push(member);
      if (matched.length > MAX_CANDIDATE_DISPLAY) break;
    }
    return matched;
  }

  private searchWithFuse(fuse: Fuse<FuseEntry>, candidate: SearchCandidate): ResolutionResult | null {
    const results = fuse.search(candidate.normalized, { limit: MAX_CANDIDATE_DISPLAY + 1 });
    if (results.length === 0) return null;

    const best = results[0];
    const bestScore = best?.score ?? 1;
    if (!best || bestScore > MAX_SCORE) return null;

    const close = results.filter((result) => (result.score ?? 1) - bestScore < MIN_SCORE_DIFFERENCE);
    if (close.length > 1) {
      return this.createAmbiguousResult(
        candidate.raw,
        close.map((result) => result.item.member),
        candidate.consumed
      );
    }

    return { member: best.item.member, consumed: candidate.consumed, confidence: bestScore };
  }

  private getOrCreateGuildIndex(guild: Guild): GuildSearchIndex {
    const cached = this.guildIndexes.get(guild.id);
    if (cached && cached.expiresAt > Date.now() && cached.sourceSize === guild.members.cache.size) {
      this.guildIndexes.delete(guild.id);
      this.guildIndexes.set(guild.id, cached);
      return cached;
    }

    const members = [...guild.members.cache.values()].slice(0, MAX_INDEXED_MEMBERS);
    const index = this.buildSearchIndex(members, guild.members.cache.size);
    this.guildIndexes.set(guild.id, index);
    this.evictOldest(this.guildIndexes, MAX_GUILD_INDEXES);
    return index;
  }

  private buildSearchIndex(members: GuildMember[], sourceSize: number): GuildSearchIndex {
    const exact = new Map<string, GuildMember[]>();
    const dataset: FuseEntry[] = [];

    for (const member of members) {
      for (const alias of this.getMemberTokens(member)) {
        const matches = exact.get(alias);
        if (matches) matches.push(member);
        else exact.set(alias, [member]);
      }
      dataset.push({
        member,
        username: member.user.username,
        displayName: member.displayName,
        globalName: member.user.globalName ?? '',
        nickname: member.nickname ?? ''
      });
    }

    const fuse = new Fuse(dataset, {
      keys: [
        { name: 'displayName', weight: 0.4 },
        { name: 'nickname', weight: 0.3 },
        { name: 'username', weight: 0.2 },
        { name: 'globalName', weight: 0.1 }
      ],
      threshold: MAX_SCORE,
      ignoreLocation: true,
      distance: 40,
      includeScore: true
    });

    return {
      members,
      exact,
      fuse,
      sourceSize,
      expiresAt: Date.now() + INDEX_TTL_MS
    };
  }

  private async searchRemoteMembers(guild: Guild, tokens: readonly string[]): Promise<GuildMember[]> {
    const queries = this.createRemoteQueries(tokens);
    const membersById = new Map<string, GuildMember>();

    for (const query of queries) {
      const members = await this.fetchRemoteMembers(guild, query);
      for (const member of members) membersById.set(member.id, member);
    }

    return [...membersById.values()];
  }

  private createRemoteQueries(tokens: readonly string[]): string[] {
    const queries: string[] = [];
    const seen = new Set<string>();
    const maximumWords = Math.min(tokens.length, MAX_REMOTE_QUERIES);

    for (let wordCount = 1; wordCount <= maximumWords; wordCount += 1) {
      const query = tokens.slice(0, wordCount).join(' ').trim().slice(0, MAX_NAME_LENGTH);
      const normalized = this.normalizeTerm(query);
      if (!normalized || normalized.length < MIN_FUZZY_QUERY_LENGTH || seen.has(normalized)) continue;
      seen.add(normalized);
      queries.push(query);
    }

    return queries;
  }

  private async fetchRemoteMembers(guild: Guild, query: string): Promise<GuildMember[]> {
    const cacheKey = `${guild.id}:${this.normalizeTerm(query) ?? query}`;
    const cached = this.remoteSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.members;

    const inFlight = this.inFlightSearches.get(cacheKey);
    if (inFlight) return (await inFlight) ?? [];

    const search = guild.members
      .search({ query, limit: REMOTE_SEARCH_LIMIT, cache: true })
      .then((collection: Collection<string, GuildMember>) => [...collection.values()])
      .catch(() => null)
      .finally(() => this.inFlightSearches.delete(cacheKey));

    if (this.inFlightSearches.size < MAX_IN_FLIGHT_SEARCHES) this.inFlightSearches.set(cacheKey, search);
    const members = await search;
    if (!members) return [];

    this.remoteSearchCache.set(cacheKey, { members, expiresAt: Date.now() + REMOTE_CACHE_TTL_MS });
    this.evictOldest(this.remoteSearchCache, MAX_REMOTE_CACHE_ENTRIES);
    return members;
  }

  private getMemberTokens(member: GuildMember): ReadonlySet<string> {
    const signature = [member.displayName, member.nickname, member.user.username, member.user.globalName].join('\0');
    const cached = this.tokenCache.get(member);
    if (cached?.signature === signature) return cached.tokens;

    const tokens = new Set<string>();
    for (const value of [member.displayName, member.nickname, member.user.username, member.user.globalName]) {
      const normalized = this.normalizeTerm(value);
      if (normalized) tokens.add(normalized);
    }
    const entry = { signature, tokens } satisfies TokenCacheEntry;
    this.tokenCache.set(member, entry);
    return tokens;
  }

  private normalizeTerm(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const normalized = raw
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    return normalized || null;
  }

  private evictOldest<TKey, TValue>(cache: Map<TKey, TValue>, maximumSize: number): void {
    while (cache.size > maximumSize) {
      const oldestKey = cache.keys().next().value as TKey | undefined;
      if (oldestKey === undefined) return;
      cache.delete(oldestKey);
    }
  }

  private createAmbiguousResult(query: string, candidates: readonly GuildMember[], consumed: number): ResolutionResult {
    return {
      member: null,
      consumed,
      confidence: null,
      reason: 'ambiguous',
      feedback: this.buildAmbiguousFeedback(query, candidates)
    };
  }

  private createNotFoundResult(): ResolutionResult {
    return {
      member: null,
      consumed: 0,
      confidence: null,
      reason: 'not_found',
      feedback: 'Could not find that member. Mention them, enter their nickname, or use their user ID.'
    };
  }

  private buildAmbiguousFeedback(query: string, candidates: readonly GuildMember[]): string {
    const list = candidates
      .slice(0, MAX_CANDIDATE_DISPLAY)
      .map((member) => `• ${this.formatMember(member)}`)
      .join('\n');
    const more = candidates.length > MAX_CANDIDATE_DISPLAY ? '\n• …and more' : '';
    return `Multiple members match "${query}". Please enter more of the nickname, mention the user, or provide their ID.\n${list}${more}`;
  }

  private formatMember(member: GuildMember): string {
    const tag = member.user.discriminator === '0' ? member.user.username : member.user.tag;
    const display =
      member.displayName && member.displayName !== member.user.username ? `${member.displayName} • ${tag}` : tag;
    return `${display} (ID: ${member.id})`;
  }
}

export const memberResolver = new MemberResolver();
