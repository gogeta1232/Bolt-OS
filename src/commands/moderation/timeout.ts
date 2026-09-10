import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { Message } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { v2 } from '../../lib/embeds.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { parseDuration } from '../../lib/utils/duration-parser.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';
import { collectEvidence } from '../../lib/evidence.js';

@ApplyOptions<Command.Options>({
  name: 'timeout',
  description: 'Timeout a member for a set duration.',
  aliases: ['tm'],
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['ModerateMembers', 'SendMessages']
})
export class TimeoutCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to timeout').setRequired(true))
          .addStringOption((option) =>
            option.setName('duration').setDescription('Duration (e.g. 1m, 1h, 1d)').setRequired(true)
          )
          .addStringOption((option) => option.setName('reason').setDescription('Reason for timeout').setRequired(false))
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
      'timeout'
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
    const durationStr = interaction.options.getString('duration', true);
    const parsed = parseDuration(durationStr);
    if (!parsed) {
      await replyToast(interaction, 'warning', 'Invalid duration format. Use: 1m, 1h, 1d, etc.');
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
    await this.applyTimeout(interaction, member, parsed.milliseconds, parsed.pretty, reason, evidence);
  }

  public override async messageRun(message: Message) {
    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }

    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await replyToast(message, 'info', 'Usage: `!timeout <member> <minutes> [reason]`');
      return;
    }

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    // Use optimized permission checker
    const hasPermission = await hasModerationPermission(guild, member, member.id, 'timeout');

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const memberResolved = resolution.member;
    if (!memberResolved) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }
    const remainingTokens = tokens.slice(resolution.consumed);
    if (!remainingTokens.length) {
      await replyToast(message, 'warning', 'Provide timeout duration (e.g. 1m, 1h, 1d).');
      return;
    }

    const durationStr = remainingTokens[0];
    const parsed = parseDuration(durationStr);
    if (!parsed) {
      await replyToast(message, 'warning', 'Invalid duration format. Use: 1m, 1h, 1d, etc.');
      return;
    }

    const rawReason = remainingTokens.slice(1).join(' ').trim() || 'No reason provided';
    const evidence = collectEvidence({ reason: rawReason, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.applyTimeout(message, memberResolved, parsed.milliseconds, parsed.pretty, reason, evidence);
  }

  private async applyTimeout(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    durationMs: number,
    durationStr: string,
    reason: string,
    evidence: string[]
  ) {
    if (!member.moderatable) {
      await replyToast(source, 'warning', `Cannot timeout ${member.user.tag}; missing permissions or role hierarchy.`);
      return;
    }

    const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
    const moderatorId = source instanceof Message ? source.author.id : source.user.id;
    const expiresAt = new Date(Date.now() + durationMs);

    // Apply timeout (critical operation)
    await member.timeout(durationMs, reason).catch(async (error) => {
      await replyToast(source, 'danger', `Failed to timeout ${member.user.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: member.guild.id }, 'Timeout command failed');
      throw error;
    });

    // RESPOND IMMEDIATELY - don't wait for case creation, DM, or logs
    const description = `${getEmoji('timeout')} ${member.user.tag} timed out for ${durationStr} • Reason: ${reason}`;
    await replyToast(source, 'success', description);

    // Fire-and-forget: case creation, DM, and logging (don't block response)
    void (async () => {
      let dmDelivered = true;
      let caseRecord;

      // Create case and send DM in parallel
      const [caseResult, dmResult] = await Promise.allSettled([
        this.container.cases.create({
          guildId: member.guild.id,
          action: 'timeout',
          targetId: member.id,
          targetTag: member.user.tag,
          moderatorId,
          moderatorTag,
          reason,
          evidence,
          expiresAt
        }),
        member.user.send(
          v2({
            title: 'Timed out',
            subtitle: member.guild.name,
            accent: 'warning',
            blocks: [reason],
            footer: `For ${durationStr} • Expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
          }) as never
        )
      ]);

      if (caseResult.status === 'fulfilled') {
        caseRecord = caseResult.value;
      } else {
        this.container.logger.error(
          { err: caseResult.reason, guildId: member.guild.id },
          'Failed to create timeout case'
        );
        return;
      }

      if (dmResult.status === 'rejected') {
        dmDelivered = false;
        this.container.logger.debug({ guildId: member.guild.id, userId: member.id }, 'Unable to DM timed out member');
      }

      // Send logs
      const moderationContext = buildModerationContext({
        actor: source instanceof Message ? source.author : source.user,
        target: member,
        reason,
        caseId: caseRecord.caseId,
        duration: durationStr
      });

      if (evidence.length || !dmDelivered) {
        moderationContext.metadata = {};
        if (evidence.length) moderationContext.metadata.Evidence = evidence.join(', ');
        moderationContext.metadata['DM Delivered'] = dmDelivered ? 'Yes' : 'No';
      }

      const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';

      try {
        await Promise.all([
          this.container.logging.sendModerationLog(
            member.guild,
            `${getEmoji('timeout')} Case #${caseRecord.caseId}: ${member.user.toString()} timed out by ${moderatorTag}`,
            moderationContext
          ),
          this.container.logging.sendCaseLog(
            member.guild,
            `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} timed out by ${moderatorTag}${evidenceSummary}`
          )
        ]);
      } catch (error) {
        this.container.logger.error({ err: error, guildId: member.guild.id }, 'Failed to dispatch timeout logs');
      }
    })();
  }
}
