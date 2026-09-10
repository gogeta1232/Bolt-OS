import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message, type ChatInputCommandInteraction, type GuildMember, type Guild, type User } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { v2 } from '../../lib/embeds.js';
import { collectEvidence } from '../../lib/evidence.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

const USER_ID_PATTERN = /^\d{17,20}$/;

interface BanTarget {
  id: string;
  tag: string;
  mention: string;
  user: User | null;
  member: GuildMember | null;
}

interface BanResolution {
  target: BanTarget | null;
  consumed: number;
  feedback?: string;
}

@ApplyOptions<Command.Options>({
  name: 'ban',
  description: 'Ban a member from the guild.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['BanMembers', 'SendMessages']
})
export class BanCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to ban').setRequired(true))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for ban').setRequired(false))
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

    const hasPermission = await hasModerationPermission(
      guild,
      interaction.member as GuildMember,
      interaction.user.id,
      'ban'
    );

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const targetMember = interaction.options.getMember('target') as GuildMember | null;
    const target = this.buildBanTarget(targetUser, targetMember);
    const rawReason = interaction.options.getString('reason') ?? 'No reason provided';
    const slashAtt = interaction.options.getAttachment('evidence');
    const evidence = collectEvidence({
      reason: rawReason,
      slashAttachmentUrl: slashAtt?.url ?? null,
      slashAttachmentMeta: slashAtt ? { contentType: slashAtt.contentType, name: slashAtt.name } : null
    });
    // Clean reason by stripping image URLs that became evidence (keeps reason readable)
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.performBan(interaction, guild, target, reason, evidence);
  }

  public override async messageRun(message: Message, args: Args) {
    void args;
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await replyToast(message, 'info', 'Usage: `!ban <member> [reason]`');
      return;
    }

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const hasPermission = await hasModerationPermission(guild, member, member.id, 'ban');

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const resolution = await this.resolveBanTarget(message, tokens);
    const target = resolution.target;
    if (!target) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }

    const rawReason = tokens.slice(resolution.consumed).join(' ').trim() || 'No reason provided';
    const evidence = collectEvidence({ reason: rawReason, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.performBan(message, guild, target, reason, evidence);
  }

  private async performBan(
    source: ChatInputCommandInteraction | Message,
    guild: Guild,
    target: BanTarget,
    reason: string,
    evidence: string[]
  ) {
    if (target.member && !target.member.bannable) {
      await replyToast(source, 'warning', `Cannot ban ${target.tag}; missing permissions or role hierarchy.`);
      return;
    }

    const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
    const moderatorId = source instanceof Message ? source.author.id : source.user.id;
    const actor = source instanceof Message ? source.author : source.user;

    try {
      await guild.members.ban(target.member ?? target.id, { reason });
    } catch (error) {
      await replyToast(source, 'danger', `Failed to ban ${target.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: guild.id }, 'Ban command failed');
      return;
    }

    await replyToast(source, 'success', `${getEmoji('ban')} ${target.tag} banned • Reason: ${reason}`);
    this.finishBanAfterResponse(guild, target, reason, evidence, moderatorId, moderatorTag, actor);
  }

  private finishBanAfterResponse(
    guild: Guild,
    target: BanTarget,
    reason: string,
    evidence: string[],
    moderatorId: string,
    moderatorTag: string,
    actor: User
  ) {
    void (async () => {
      const fetchedUser = target.user
        ? target.user
        : await this.container.client.users.fetch(target.id).catch(() => null);
      const resolvedTarget = this.buildBanTarget(fetchedUser, target.member, target.id);

      const caseRecord = await this.container.cases.create({
        guildId: guild.id,
        action: 'ban',
        targetId: resolvedTarget.id,
        targetTag: resolvedTarget.tag,
        moderatorId,
        moderatorTag,
        reason,
        evidence
      });

      const dmOutcome = resolvedTarget.user
        ? {
            delivered: await this.sendBasicBanNotice(guild, resolvedTarget.user, { caseId: caseRecord.caseId, reason }),
            appealsEnabled: false
          }
        : { delivered: false, appealsEnabled: false };

      if (!dmOutcome.delivered) {
        this.container.logger.warn({ guildId: guild.id, userId: resolvedTarget.id }, 'Unable to DM banned user');
      }

      const moderationContext = buildModerationContext({
        actor,
        target: resolvedTarget.member ?? resolvedTarget.user,
        reason,
        caseId: caseRecord.caseId
      });

      if (evidence.length || !dmOutcome.delivered || !resolvedTarget.user) {
        moderationContext.metadata = {};
        if (evidence.length) moderationContext.metadata.Evidence = evidence.join(', ');
        if (!resolvedTarget.user) moderationContext.metadata['Target ID'] = resolvedTarget.id;
        moderationContext.metadata['DM Delivered'] = dmOutcome.delivered ? 'Yes' : 'No';
      }

      const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';

      await Promise.all([
        this.container.logging.sendModerationLog(
          guild,
          `${getEmoji('ban')} Case #${caseRecord.caseId}: ${resolvedTarget.mention} banned by ${moderatorTag}`,
          moderationContext
        ),
        this.container.logging.sendCaseLog(
          guild,
          `${getEmoji('case')} Case #${caseRecord.caseId} — ${resolvedTarget.mention} banned by ${moderatorTag}${evidenceSummary}`
        )
      ]);
    })().catch((error) => {
      this.container.logger.error(
        { err: error, guildId: guild.id, userId: target.id },
        'Failed to finish ban background work'
      );
    });
  }

  private async resolveBanTarget(message: Message, tokens: string[]): Promise<BanResolution> {
    const guild = message.guild;
    if (!guild || tokens.length === 0) {
      return { target: null, consumed: 0, feedback: 'Provide a member mention, user ID, or username.' };
    }

    const mentionedMember = message.mentions.members?.first() ?? null;
    if (mentionedMember) {
      const mentionIndex = tokens.findIndex((token) => token.includes(mentionedMember.id));
      return {
        target: this.buildBanTarget(mentionedMember.user, mentionedMember),
        consumed: mentionIndex >= 0 ? mentionIndex + 1 : 1
      };
    }

    const mentionedUser = message.mentions.users.first() ?? null;
    if (mentionedUser) {
      const member =
        guild.members.cache.get(mentionedUser.id) ?? (await guild.members.fetch(mentionedUser.id).catch(() => null));
      const mentionIndex = tokens.findIndex((token) => token.includes(mentionedUser.id));
      return {
        target: this.buildBanTarget(mentionedUser, member),
        consumed: mentionIndex >= 0 ? mentionIndex + 1 : 1
      };
    }

    const directUserId = this.extractUserId(tokens[0]);
    if (directUserId) {
      const member = guild.members.cache.get(directUserId) ?? null;
      return {
        target: this.buildBanTarget(member?.user ?? null, member, directUserId),
        consumed: 1
      };
    }

    const memberResolution = await this.container.memberResolver.resolve(message, tokens);
    if (!memberResolution.member) {
      return {
        target: null,
        consumed: 0,
        feedback: memberResolution.feedback ?? 'Could not find that member. Mention them or use their user ID.'
      };
    }

    return {
      target: this.buildBanTarget(memberResolution.member.user, memberResolution.member),
      consumed: memberResolution.consumed
    };
  }

  private buildBanTarget(user: User | null, member: GuildMember | null, idOverride?: string): BanTarget {
    const id = member?.id ?? user?.id ?? idOverride;
    if (!id) {
      throw new Error('Cannot build ban target without a user ID.');
    }

    return {
      id,
      tag: member?.user.tag ?? user?.tag ?? `User ID ${id}`,
      mention: `<@${id}>`,
      user: member?.user ?? user,
      member
    };
  }

  private extractUserId(input: string | null | undefined) {
    if (!input) return null;
    const id = input.replace(/[^0-9]/g, '');
    return USER_ID_PATTERN.test(id) ? id : null;
  }

  private async sendBasicBanNotice(guild: Guild, user: User, context: { caseId: number; reason: string }) {
    try {
      await user.send(
        v2({
          title: 'Banned',
          subtitle: `${guild.name} • Case #${context.caseId}`,
          accent: 'danger',
          blocks: [context.reason]
        }) as never
      );
      return true;
    } catch (error) {
      this.container.logger.debug({ err: error, guildId: guild.id, userId: user.id }, 'Failed to DM banned member');
      return false;
    }
  }
}
