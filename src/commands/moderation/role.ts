import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { GuildMember, Message, Role, type ChatInputCommandInteraction, type Guild } from 'discord.js';
import Fuse from 'fuse.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { replyGuildOnly, replyToast } from '../../lib/respond.js';
import { collectEvidence } from '../../lib/evidence.js';

interface ResolvedToggle {
  role: Role;
  member: GuildMember;
  reason: string;
  evidence: string[];
}

/**
 * Cache for Fuse.js instances to avoid rebuilding search index
 */
const roleSearchCache = new Map<string, { fuse: Fuse<Role>; roles: Role[] }>();

/**
 * Simple in-memory cache for role and member search results with TTL
 */
const searchResultCache = new Map<string, { timestamp: number; data: unknown }>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached result if available and not expired
 */
function getCachedResult<T>(key: string): T | null {
  const cached = searchResultCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    searchResultCache.delete(key);
    return null;
  }

  return cached.data as T;
}

/**
 * Cache search result
 */
function setCachedResult<T>(key: string, data: T): void {
  searchResultCache.set(key, {
    timestamp: Date.now(),
    data
  });
}

@ApplyOptions<Command.Options>({
  name: 'role',
  description: 'Toggle a role for a member using intelligent matching.',
  requiredClientPermissions: ['SendMessages', 'ManageRoles'],
  runIn: ['GUILD_ANY'],
  fullCategory: ['moderation']
})
export class RoleToggleCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) =>
            option.setName('target').setDescription('Member to toggle the role for').setRequired(true)
          )
          .addRoleOption((option) => option.setName('role').setDescription('Role to toggle'))
          .addStringOption((option) => option.setName('role_name').setDescription('Role name to search for'))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for the toggle'))
          .addAttachmentOption((option) => option.setName('evidence').setDescription('Evidence attachment')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    if (!interaction.guild) {
      await replyGuildOnly(interaction);
      return;
    }

    const member = await interaction.options.getMember('target');
    if (!member || !(member instanceof GuildMember)) {
      await replyToast(interaction, 'warning', 'Member not found in this guild.');
      return;
    }

    const explicitRole = interaction.options.getRole('role');
    const roleName = interaction.options.getString('role_name');
    const reasonRaw = interaction.options.getString('reason') ?? 'No reason provided';
    const slashAtt = interaction.options.getAttachment('evidence');
    const evidence = collectEvidence({
      reason: reasonRaw,
      slashAttachmentUrl: slashAtt?.url ?? null,
      slashAttachmentMeta: slashAtt ? { contentType: slashAtt.contentType, name: slashAtt.name } : null
    });
    const reasonCleaned = evidence.length
      ? reasonRaw
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || reasonRaw
      : reasonRaw;

    let role: Role | null = null;
    if (explicitRole) {
      role = explicitRole instanceof Role ? explicitRole : (interaction.guild.roles.cache.get(explicitRole.id) ?? null);
    }
    if (!role && roleName) {
      role = (await this.findRole(interaction.guild, roleName)).role;
    }

    if (!role) {
      await replyToast(interaction, 'warning', 'Could not resolve the specified role.');
      return;
    }

    await this.toggleRole({ role, member, reason: reasonCleaned, evidence }, interaction);
  }

  public override async messageRun(message: Message) {
    await this.ensureAdmin(message);
    if (!message.guild) return;

    const [, ...restParts] = message.content.trim().split(/\s+/);
    const remainder = restParts.join(' ').trim();
    if (!remainder) {
      await replyToast(message, 'info', 'Usage: role <role query> <member query> | <optional reason>');
      return;
    }

    const [assignmentRaw, reasonRaw] = remainder.split('|').map((part) => part.trim());
    const rawReason = reasonRaw?.length ? reasonRaw : 'No reason provided';
    const evidence = collectEvidence({ reason: rawReason, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;

    const resolved = await this.resolveToggleFromMessage(message, assignmentRaw ?? remainder, reason, evidence);
    if (!resolved) {
      await replyToast(message, 'warning', 'Could not determine the role and member from your input.');
      return;
    }

    if ('feedback' in resolved) {
      await replyToast(message, 'warning', resolved.feedback);
      return;
    }

    await this.toggleRole(resolved, message);
  }

  private async toggleRole(context: ResolvedToggle, source: ChatInputCommandInteraction | Message) {
    const guild = context.member.guild;
    const me = guild.members.me;
    if (!me || me.roles.highest.comparePositionTo(context.role) <= 0) {
      await replyToast(source, 'warning', 'Cannot manage the specified role due to role hierarchy.');
      return;
    }

    if (!context.role.editable) {
      await replyToast(source, 'warning', 'The specified role is not editable by the bot.');
      return;
    }

    const moderatorId = source instanceof Message ? source.author.id : source.user.id;
    const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
    const hasRole = context.member.roles.cache.has(context.role.id);

    try {
      if (hasRole) {
        await context.member.roles.remove(context.role, context.reason);
      } else {
        await context.member.roles.add(context.role, context.reason);
      }

      const actionText = hasRole ? 'removed from' : 'assigned to';
      const roleMention = context.role.toString();
      const memberMention = context.member.toString();
      await replyToast(source, 'primary', `${getEmoji('role')} | ${roleMention} ${actionText} ${memberMention}`);

      const hasCustomReason = context.reason && context.reason !== 'No reason provided';
      const caseReason = `${hasRole ? 'Removed' : 'Assigned'} role ${context.role.name}${hasCustomReason ? ` — ${context.reason}` : ''}`;
      const caseRecord = await this.container.cases.create({
        guildId: guild.id,
        action: 'role',
        targetId: context.member.id,
        targetTag: context.member.user.tag,
        moderatorId,
        moderatorTag,
        reason: caseReason,
        evidence: context.evidence
      });

      const moderationContext = buildModerationContext({
        actor: source instanceof Message ? source.author : source.user,
        target: context.member,
        reason: caseReason,
        caseId: caseRecord.caseId
      });

      const metadata: Record<string, string> = {
        Action: hasRole ? 'Role Removed' : 'Role Assigned',
        Role: context.role.name
      };
      if (context.evidence.length) metadata.Evidence = context.evidence.join(', ');
      moderationContext.metadata = metadata;

      const evidenceSummary = context.evidence.length
        ? `\n${getEmoji('evidence')} Evidence: ${context.evidence.join(', ')}`
        : '';
      // Fire-and-forget parallel logging for better performance
      Promise.all([
        this.container.logging.sendAdministrativeLog(
          guild,
          `${getEmoji('role')} Case #${caseRecord.caseId}: ${context.member.user.toString()} ${hasRole ? 'role removed' : 'role assigned'} by ${moderatorTag}`,
          moderationContext
        ),
        this.container.logging.sendCaseLog(
          guild,
          `${getEmoji('case')} Case #${caseRecord.caseId} — ${context.member.user.toString()} ${hasRole ? 'role removed' : 'role assigned'}${evidenceSummary}`
        )
      ]).catch((error) => {
        this.container.logger.error({ err: error, guildId: guild.id }, 'Failed to dispatch role toggle logs');
      });
    } catch (error) {
      this.container.logger.error({ err: error, guildId: guild.id }, 'Failed to toggle role');
      await replyToast(source, 'danger', `Failed to toggle role: ${(error as Error).message}`);
    }
  }

  private async resolveToggleFromMessage(
    message: Message,
    assignmentRaw: string,
    reason: string,
    evidence: string[]
  ): Promise<ResolvedToggle | { feedback: string } | null> {
    const guild = message.guild;
    if (!guild) return null;

    let feedback: string | null = null;

    let working = assignmentRaw;
    let role = message.mentions.roles.first() ?? null;
    if (role) {
      working = working.replace(role.toString(), '').trim();
    }
    let member = message.mentions.members?.first() ?? null;
    if (member) {
      working = working.replace(member.toString(), '').trim();
    }

    if (!working.length && role && member) {
      return { role, member, reason, evidence };
    }

    const tokens = working.split(/\s+/).filter(Boolean);

    if (role && !member) {
      const memberResult = await this.findMember(message, tokens.join(' '));
      member = memberResult.member;
      if (!member) {
        if (memberResult.feedback) feedback = memberResult.feedback;
        return feedback ? { feedback } : null;
      }
      return { role, member, reason, evidence };
    }

    if (!role && member) {
      const roleResult = await this.findRole(guild, tokens.join(' '));
      role = roleResult.role;
      if (!role) return null;
      return { role, member, reason, evidence };
    }

    if (!role && !member) {
      const memberFirst = await this.findMember(message, tokens.join(' '));
      if (!memberFirst.member && memberFirst.feedback) {
        feedback = memberFirst.feedback;
      }
      if (memberFirst.member) {
        const consumed = Math.max(memberFirst.consumed ?? 0, 1);
        const remaining = tokens.slice(consumed);
        const roleQuery = remaining.join(' ').trim();
        if (roleQuery.length) {
          const roleResult = await this.findRole(guild, roleQuery);
          if (roleResult.role) {
            return {
              role: roleResult.role,
              member: memberFirst.member,
              reason,
              evidence
            };
          }
        }
      }

      if (tokens.length < 2) return null;

      // Execute ALL role/member searches in PARALLEL for maximum speed
      // This replaces the sequential O(n²) loop with parallel execution
      const searchPromises: Promise<{
        roleResult: { role: Role | null; score: number };
        memberResult: { member: GuildMember | null; score: number; feedback?: string };
        split: number;
      }>[] = [];

      for (let split = 1; split < tokens.length; split++) {
        const roleQuery = tokens.slice(0, split).join(' ');
        const memberQuery = tokens.slice(split).join(' ');

        // Run role and member search in parallel for each split
        const promise = (async () => {
          const [roleResult, memberResult] = await Promise.all([
            this.findRole(guild, roleQuery),
            this.findMember(message, memberQuery)
          ]);
          return { roleResult, memberResult, split };
        })();

        searchPromises.push(promise);
      }

      // Wait for all searches to complete
      const results = await Promise.all(searchPromises);

      // Find the best match from all parallel results
      let best: { score: number; role: Role; member: GuildMember } | null = null;

      for (const { roleResult, memberResult } of results) {
        if (!memberResult.member && memberResult.feedback) {
          feedback = memberResult.feedback;
        }
        if (!roleResult.role || !memberResult.member) continue;

        const totalScore = (roleResult.score ?? 0) + (memberResult.score ?? 0);
        if (!best || totalScore < best.score) {
          best = {
            role: roleResult.role,
            member: memberResult.member,
            score: totalScore
          };
        }
      }

      if (best) {
        return { role: best.role, member: best.member, reason, evidence };
      }
    }

    if (role && member) {
      return { role, member, reason, evidence };
    }

    return feedback ? { feedback } : null;
  }

  private async findRole(guild: Guild, query: string) {
    if (!query) {
      return { role: null as Role | null, score: Number.POSITIVE_INFINITY };
    }

    // Check result cache first
    const cacheKey = `role_${guild.id}_${query}`;
    const cached = getCachedResult<{ role: Role | null; score: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    const trimmed = query.trim();
    if (/^\d{5,}$/.test(trimmed)) {
      const role = guild.roles.cache.get(trimmed) ?? (await guild.roles.fetch(trimmed).catch(() => null));
      if (role) {
        const result = { role, score: 0 };
        setCachedResult(cacheKey, result);
        return result;
      }
    }

    // Check Fuse cache first - use guild ID as cache key
    const fuseCacheKey = `${guild.id}`;
    let fuseCached = roleSearchCache.get(fuseCacheKey);

    // Rebuild cache if not exists or if roles changed
    if (!fuseCached || fuseCached.roles.length !== guild.roles.cache.size) {
      const roles = Array.from(guild.roles.cache.values());
      const fuse = new Fuse(roles, {
        keys: ['name'],
        threshold: 0.4,
        ignoreLocation: true
      });
      fuseCached = { fuse, roles };
      roleSearchCache.set(fuseCacheKey, fuseCached);
    }

    const match = fuseCached.fuse.search(trimmed)[0];
    const result = match
      ? { role: match.item, score: match.score ?? 0 }
      : { role: null as Role | null, score: Number.POSITIVE_INFINITY };

    // Cache the result
    setCachedResult(cacheKey, result);
    return result;
  }

  private async findMember(message: Message, query: string) {
    if (!query) {
      return {
        member: null as GuildMember | null,
        score: Number.POSITIVE_INFINITY,
        consumed: 0,
        feedback: 'Provide a member name to search for.'
      };
    }

    const guildId = message.guild?.id ?? 'dm';
    const cacheKey = `member_${guildId}_${query}`;
    const cached = getCachedResult<{
      member: GuildMember | null;
      score: number;
      consumed: number;
      feedback?: string;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      const result = {
        member: null as GuildMember | null,
        score: Number.POSITIVE_INFINITY,
        consumed: 0,
        feedback: 'Provide a member name to search for.'
      };
      setCachedResult(cacheKey, result);
      return result;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const result = !resolution.member
      ? {
          member: null as GuildMember | null,
          score: Number.POSITIVE_INFINITY,
          consumed: 0,
          feedback: resolution.feedback
        }
      : {
          member: resolution.member,
          score: resolution.confidence ?? 0,
          consumed: resolution.consumed
        };

    // Cache the result
    setCachedResult(cacheKey, result);
    return result;
  }
}
