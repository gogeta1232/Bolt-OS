import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { GuildMember, Message, type ChatInputCommandInteraction } from 'discord.js';
import Fuse from 'fuse.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { v2 } from '../../lib/embeds.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { parseDuration } from '../../lib/utils/duration-parser.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';
import { collectEvidence } from '../../lib/evidence.js';

interface MessageContext {
  member: GuildMember;
  durationMs: number | null;
  durationStr: string | null;
  reason: string;
  evidence: string[];
}

@ApplyOptions<Command.Options>({
  name: 'mute',
  description: 'Mute a member, optionally for a duration.',
  requiredClientPermissions: ['SendMessages', 'ManageRoles'],
  runIn: ['GUILD_ANY'],
  fullCategory: ['moderation']
})
export class MuteCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to mute').setRequired(true))
          .addStringOption((option) => option.setName('duration').setDescription('Duration (e.g. 1m, 1h, 1d)'))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for mute'))
          .addAttachmentOption((option) => option.setName('evidence').setDescription('Evidence attachment')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await replyGuildOnly(interaction);
      return;
    }

    // Use optimized permission checker
    const hasPermission = await hasModerationPermission(
      guild,
      interaction.member as GuildMember,
      interaction.user.id,
      'mute'
    );

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const member = await interaction.options.getMember('target');
    if (!member || !(member instanceof GuildMember)) {
      await replyToast(interaction, 'warning', 'Member not found in this guild.');
      return;
    }

    let durationMs: number | null = null;
    let durationStr: string | null = null;
    const durationInput = interaction.options.getString('duration');
    if (durationInput) {
      const parsed = parseDuration(durationInput);
      if (!parsed) {
        await replyToast(interaction, 'warning', 'Invalid duration format. Use: 1m, 1h, 1d, etc.');
        return;
      }
      durationMs = parsed.milliseconds;
      durationStr = parsed.pretty;
    }

    const rawReason = interaction.options.getString('reason') ?? 'No reason provided';
    const slashAtt = interaction.options.getAttachment('evidence');
    const evidence = collectEvidence({
      reason: rawReason,
      slashAttachmentUrl: slashAtt?.url ?? null,
      slashAttachmentMeta: slashAtt ? { contentType: slashAtt.contentType, name: slashAtt.name } : null
    });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.applyMute(interaction, member, durationMs, durationStr, reason, evidence);
  }

  public override async messageRun(message: Message) {
    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    // Use optimized permission checker
    const hasPermission = await hasModerationPermission(guild, member, member.id, 'mute');

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const parsed = await this.parseMessageArgs(message);
    if (!parsed) return;
    await this.applyMute(message, parsed.member, parsed.durationMs, parsed.durationStr, parsed.reason, parsed.evidence);
  }

  private async applyMute(
    source: ChatInputCommandInteraction | Message,
    targetMember: GuildMember,
    durationMs: number | null,
    durationStr: string | null,
    reason: string,
    evidence: string[]
  ) {
    const guild = targetMember.guild;
    const config = await this.container.config.fetch(guild.id);
    if (!config.mutedRoleId) {
      await replyToast(source, 'warning', 'Muted role is not configured for this guild.');
      return;
    }

    const muteRole = guild.roles.cache.get(config.mutedRoleId) ?? (await guild.roles.fetch(config.mutedRoleId));
    if (!muteRole) {
      await replyToast(source, 'warning', 'Configured muted role could not be found. Please update your settings.');
      return;
    }

    const me = guild.members.me;
    if (!me || me.roles.highest.comparePositionTo(muteRole) <= 0) {
      await replyToast(source, 'warning', 'Cannot assign the muted role due to role hierarchy.');
      return;
    }

    if (!targetMember.manageable) {
      await replyToast(
        source,
        'warning',
        `Cannot mute ${targetMember.user.tag}; missing permissions or role hierarchy.`
      );
      return;
    }

    try {
      const moderatorId = source instanceof Message ? source.author.id : source.user.id;
      const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
      const actor = source instanceof Message ? source.author : source.user;
      const expiresAt = durationMs ? new Date(Date.now() + durationMs) : undefined;

      await targetMember.roles.add(muteRole, reason);

      const description = `${getEmoji('mute')} ${targetMember.user.tag} muted${durationStr ? ` for ${durationStr}` : ''} • Reason: ${reason}`;

      await replyToast(source, 'success', description);
      this.finishMuteAfterResponse({
        guild,
        targetMember,
        muteRoleId: muteRole.id,
        durationMs,
        durationStr,
        reason,
        evidence,
        expiresAt,
        moderatorId,
        moderatorTag,
        actor
      });
    } catch (error) {
      this.container.logger.error({ err: error, guildId: guild.id }, 'Failed to mute member');
      await replyToast(source, 'danger', `Failed to mute ${targetMember.user.tag}: ${(error as Error).message}`);
    }
  }

  private finishMuteAfterResponse(options: {
    guild: GuildMember['guild'];
    targetMember: GuildMember;
    muteRoleId: string;
    durationMs: number | null;
    durationStr: string | null;
    reason: string;
    evidence: string[];
    expiresAt?: Date;
    moderatorId: string;
    moderatorTag: string;
    actor: GuildMember['user'];
  }) {
    void (async () => {
      const schedulePromise = options.durationMs
        ? this.container.muteScheduler.schedule({
            guildId: options.guild.id,
            userId: options.targetMember.id,
            roleId: options.muteRoleId,
            delayMs: options.durationMs
          })
        : this.container.muteScheduler.clear(options.guild.id, options.targetMember.id);

      const [caseRecord, dmResult, scheduleResult] = await Promise.allSettled([
        this.container.cases.create({
          guildId: options.guild.id,
          action: 'mute',
          targetId: options.targetMember.id,
          targetTag: options.targetMember.user.tag,
          moderatorId: options.moderatorId,
          moderatorTag: options.moderatorTag,
          reason: options.reason,
          evidence: options.evidence,
          expiresAt: options.expiresAt
        }),
        options.targetMember.user.send(
          v2({
            title: 'Muted',
            subtitle: options.guild.name,
            accent: 'warning',
            blocks: [options.reason],
            footer:
              options.durationStr && options.expiresAt
                ? `For ${options.durationStr} • Expires <t:${Math.floor(options.expiresAt.getTime() / 1000)}:R>`
                : 'Permanent'
          }) as never
        ),
        schedulePromise
      ]);

      if (scheduleResult.status === 'rejected') {
        this.container.logger.error(
          { err: scheduleResult.reason, guildId: options.guild.id, userId: options.targetMember.id },
          'Failed to schedule mute expiry'
        );
      }

      const dmDelivered = dmResult.status === 'fulfilled';
      if (!dmDelivered) {
        this.container.logger.debug(
          { guildId: options.guild.id, userId: options.targetMember.id },
          'Unable to DM muted member'
        );
      }

      if (caseRecord.status === 'rejected') {
        this.container.logger.error(
          { err: caseRecord.reason, guildId: options.guild.id, userId: options.targetMember.id },
          'Failed to create mute case'
        );
        return;
      }

      const moderationContext = buildModerationContext({
        actor: options.actor,
        target: options.targetMember,
        reason: options.reason,
        caseId: caseRecord.value.caseId,
        duration: options.durationStr
      });

      const metadata: Record<string, string> = {};
      if (options.durationStr) metadata.Duration = options.durationStr;
      if (options.evidence.length) metadata.Evidence = options.evidence.join(', ');
      metadata['DM Delivered'] = dmDelivered ? 'Yes' : 'No';
      if (Object.keys(metadata).length > 0) {
        moderationContext.metadata = metadata;
      }

      const evidenceSummary = options.evidence.length ? ` • Evidence: ${options.evidence.join(', ')}` : '';

      await Promise.all([
        this.container.logging.sendModerationLog(
          options.guild,
          `${getEmoji('mute')} Case #${caseRecord.value.caseId}: ${options.targetMember.user.toString()} muted by ${options.moderatorTag}`,
          moderationContext
        ),
        this.container.logging.sendCaseLog(
          options.guild,
          `${getEmoji('case')} Case #${caseRecord.value.caseId} — ${options.targetMember.user.toString()} muted by ${options.moderatorTag}${evidenceSummary}`
        )
      ]);
    })().catch((error) => {
      this.container.logger.error(
        { err: error, guildId: options.guild.id, userId: options.targetMember.id },
        'Failed to finish mute background work'
      );
    });
  }

  private async parseMessageArgs(message: Message): Promise<MessageContext | null> {
    const raw = message.content.trim().split(/\s+/);
    if (raw.length <= 1) {
      await replyToast(message, 'warning', 'Provide a member to mute.');
      return null;
    }

    const remainder = raw.slice(1).join(' ');

    const { member, rest, feedback } = await this.resolveMemberFromMessage(message, remainder);
    if (!member) {
      await replyToast(message, 'warning', feedback ?? 'Could not find the specified member.');
      return null;
    }

    const { durationMs, durationStr, reason: rawReason } = this.extractDurationAndReason(rest);
    const evidence = collectEvidence({ reason: rest, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    return { member, durationMs, durationStr, reason, evidence };
  }

  private async resolveMemberFromMessage(message: Message, input: string) {
    const guild = message.guild;
    if (!guild)
      return {
        member: null,
        rest: '',
        feedback: 'This command can only be used in a guild.'
      };

    const mention = message.mentions.members?.first();
    if (mention) {
      const rest = input.replace(mention.toString(), '').trim();
      return { member: mention, rest };
    }

    const tokens = input.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return {
        member: null,
        rest: '',
        feedback: 'Provide a member to target.'
      };
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    if (resolution.member) {
      const consumed = Math.max(resolution.consumed, 1);
      const restTokens = tokens.slice(consumed);
      const rest = restTokens.join(' ').trim();
      return { member: resolution.member, rest };
    }

    if (resolution.reason === 'ambiguous' && resolution.feedback) {
      return { member: null, rest: input, feedback: resolution.feedback };
    }

    // Optimized member resolution with early returns
    let bestMatch: { member: GuildMember; score: number; rest: string } | null = null;

    // Try ID match first (fastest)
    for (let i = 1; i <= Math.min(tokens.length, 2); i++) {
      const candidate = tokens.slice(0, i).join(' ');
      if (/^\d{17,20}$/.test(candidate)) {
        const byId = await guild.members.fetch(candidate).catch(() => null);
        if (byId) {
          return { member: byId, rest: tokens.slice(i).join(' ').trim() };
        }
      }
    }

    // Try fuzzy search with decreasing token count
    for (let i = Math.min(tokens.length, 3); i > 0; i--) {
      const userQuery = tokens.slice(0, i).join(' ');
      const rest = tokens.slice(i).join(' ').trim();

      const fetched = await guild.members.fetch({ query: userQuery, limit: 10 }).catch(() => null);

      const memberList = fetched
        ? Array.from(fetched.values())
        : Array.from(guild.members.cache.values()).slice(0, 100); // Limit cache search

      if (memberList.length === 0) continue;

      const fuse = new Fuse(memberList, {
        keys: [
          { name: 'user.username', weight: 0.5 },
          { name: 'user.tag', weight: 0.4 },
          { name: 'displayName', weight: 0.3 }
        ],
        threshold: 0.4,
        ignoreLocation: true
      });

      const match = fuse.search(userQuery)[0];
      if (match) {
        const score = match.score ?? 0;
        if (!bestMatch || score < bestMatch.score) {
          bestMatch = { member: match.item, score, rest };
        }
        // If we have a very good match (< 0.1), return early
        if (score < 0.1) {
          return { member: match.item, rest };
        }
      }
    }

    if (bestMatch) {
      return { member: bestMatch.member, rest: bestMatch.rest };
    }

    return { member: null, rest: input, feedback: resolution.feedback };
  }

  private extractDurationAndReason(input: string) {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        durationMs: null,
        durationStr: null,
        reason: 'No reason provided'
      };
    }

    const parts = trimmed.split(/\s+/);
    const first = parts[0];

    // Try to parse as duration (e.g., 1m, 1h, 1d)
    const parsed = parseDuration(first);
    if (parsed) {
      const reason = parts.slice(1).join(' ').trim() || 'No reason provided';
      return {
        durationMs: parsed.milliseconds,
        durationStr: parsed.pretty,
        reason
      };
    }

    // If first part isn't duration, everything is reason
    return { durationMs: null, durationStr: null, reason: trimmed };
  }
}
