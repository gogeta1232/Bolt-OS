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
  name: 'softban',
  description: 'Ban and immediately unban a member to purge recent messages.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['BanMembers', 'SendMessages'],
  fullCategory: ['moderation']
})
export class SoftbanCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to softban').setRequired(true))
          .addIntegerOption((option) =>
            option
              .setName('purge_days')
              .setDescription('How many days of messages to delete (1-7)')
              .setMinValue(1)
              .setMaxValue(7)
          )
          .addStringOption((option) => option.setName('reason').setDescription('Reason for the softban'))
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
      'softban'
    );
    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const target = interaction.options.getMember('target') as GuildMember | null;
    if (!target) {
      await replyToast(interaction, 'warning', 'Cannot find that member.');
      return;
    }
    const purgeDays = interaction.options.getInteger('purge_days') ?? 1;
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
    await this.performSoftban(interaction, target, purgeDays, reason, evidence);
  }

  public override async messageRun(message: Message, args: Args) {
    void args;
    const origin = message.channel;
    if (!origin || !('send' in origin)) return;

    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }

    const executor = message.member;
    if (!executor) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const hasPermission = await hasModerationPermission(guild, executor, executor.id, 'softban');
    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await replyToast(message, 'info', 'Usage: `!softban <member> [days=1-7] [reason]`');
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }
    const remainingTokens = tokens.slice(resolution.consumed);
    let purgeDays = 1;
    let reasonTokens = remainingTokens;
    if (remainingTokens.length) {
      const numeric = Number(remainingTokens[0]);
      if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 7) {
        purgeDays = Math.floor(numeric);
        reasonTokens = remainingTokens.slice(1);
      }
    }

    const rawReason = reasonTokens.join(' ').trim() || 'No reason provided';
    const evidence = collectEvidence({ reason: rawReason, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.performSoftban(message, member, purgeDays, reason, evidence);
  }

  private async performSoftban(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    purgeDaysInput: number,
    reason: string,
    evidence: string[] = []
  ) {
    const guild = member.guild;
    const purgeDays = Math.min(Math.max(purgeDaysInput, 1), 7);

    if (!member.bannable) {
      await replyToast(source, 'warning', `Cannot softban ${member.user.tag}; missing permissions or role hierarchy.`);
      return;
    }

    try {
      await guild.members.ban(member, { reason, deleteMessageSeconds: purgeDays * 86_400 });
      await guild.members.unban(member.id, 'Softban cleanup');

      const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
      const moderatorId = source instanceof Message ? source.author.id : source.user.id;

      await replyToast(
        source,
        'success',
        `${getEmoji('ban')} ${member.user.tag} softbanned • Deleted ${purgeDays} day(s) of messages.`
      );

      const caseRecord = await this.container.cases.create({
        guildId: guild.id,
        action: 'softban',
        targetId: member.id,
        targetTag: member.user.tag,
        moderatorId,
        moderatorTag,
        reason,
        evidence
      });

      const moderationContext = buildModerationContext({
        actor: source instanceof Message ? source.author : source.user,
        target: member,
        reason,
        caseId: caseRecord.caseId
      });
      moderationContext.metadata = {
        'Messages Deleted': `${purgeDays} day(s)`,
        ...(evidence.length ? { Evidence: evidence.join(', ') } : {})
      };

      void (async () => {
        try {
          await this.container.logging.sendModerationLog(
            guild,
            `${getEmoji('ban')} Case #${caseRecord.caseId}: ${member.user.toString()} softbanned by ${moderatorTag}`,
            moderationContext
          );
          const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';
          await this.container.logging.sendCaseLog(
            guild,
            `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} softbanned by ${moderatorTag}${evidenceSummary}`
          );
        } catch (error) {
          this.container.logger.error({ err: error, guildId: guild.id }, 'Failed to dispatch softban logs');
        }
      })();
    } catch (error) {
      this.container.logger.error({ err: error, guildId: guild.id }, 'Softban command failed');
      await replyToast(source, 'danger', `Failed to softban ${member.user.tag}.`);
    }
  }
}
