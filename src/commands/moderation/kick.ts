import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { collectEvidence } from '../../lib/evidence.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

@ApplyOptions<Command.Options>({
  name: 'kick',
  description: 'Kick a member from the guild.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['KickMembers', 'SendMessages']
})
export class KickCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to kick').setRequired(true))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for kick').setRequired(false))
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
      'kick'
    );
    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const member = interaction.options.getMember('target') as GuildMember | null;
    if (!member) {
      await replyToast(interaction, 'danger', 'Cannot find that member.');
      return;
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
    await this.performKick(interaction, member, reason, evidence);
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
      await replyToast(message, 'info', 'Usage: `!kick <member> [reason]`');
      return;
    }

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const hasPermission = await hasModerationPermission(guild, member, member.id, 'kick');
    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const targetMember = resolution.member;
    if (!targetMember) {
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
    await this.performKick(message, targetMember, reason, evidence);
  }

  private async performKick(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    reason: string,
    evidence: string[]
  ) {
    if (!member.kickable) {
      await replyToast(source, 'warning', `Cannot kick ${member.user.tag}; missing permissions or role hierarchy.`);
      return;
    }

    try {
      await member.kick(reason);
      const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
      const moderatorId = source instanceof Message ? source.author.id : source.user.id;
      const description = `${getEmoji('kick')} ${member.user.tag} kicked • Reason: ${reason}`;
      await replyToast(source, 'success', description);
      const caseRecord = await this.container.cases.create({
        guildId: member.guild.id,
        action: 'kick',
        targetId: member.id,
        targetTag: member.user.tag,
        moderatorId,
        moderatorTag,
        reason,
        evidence
      });
      const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';
      const moderationContext = buildModerationContext({
        actor: source instanceof Message ? source.author : source.user,
        target: member,
        reason,
        caseId: caseRecord.caseId
      });

      if (evidence.length) {
        moderationContext.metadata = {
          Evidence: evidence.join(', ')
        };
      }

      void (async () => {
        try {
          await this.container.logging.sendModerationLog(
            member.guild,
            `${getEmoji('kick')} Case #${caseRecord.caseId}: ${member.user.toString()} kicked by ${moderatorTag}`,
            moderationContext
          );
          await this.container.logging.sendCaseLog(
            member.guild,
            `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} kicked by ${moderatorTag}${evidenceSummary}`
          );
        } catch (error) {
          this.container.logger.error({ err: error, guildId: member.guild.id }, 'Failed to dispatch kick logs');
        }
      })();
    } catch (error) {
      await replyToast(source, 'danger', `Failed to kick ${member.user.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: member.guild.id }, 'Kick command failed');
    }
  }
}
