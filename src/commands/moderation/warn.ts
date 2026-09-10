import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  GuildMember,
  Message,
  MessageFlags,
  type ModalSubmitInteraction
} from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { v2 } from '../../lib/embeds.js';
import { buildWarnConfirmationContainer } from '../../lib/warn-views.js';
import { parseDuration } from '../../lib/utils/duration-parser.js';
import { replyNoPermission, replyContainer, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';
import { collectEvidence } from '../../lib/evidence.js';

const MODAL_PREFIX = 'warn:issue:';
const MODAL_DURATION_ID = 'duration';
type WarnAction = 'issue' | 'history' | 'clear' | 'remove';

@ApplyOptions<Command.Options>({
  name: 'warn',
  description: 'Issue and manage warnings.',
  requiredClientPermissions: ['SendMessages']
})
export class WarnCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('issue')
              .setDescription('Issue a warning via modal.')
              .addUserOption((option) => option.setName('target').setDescription('Member to warn').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('history')
              .setDescription('Show warnings for a member.')
              .addUserOption((option) => option.setName('target').setDescription('Member to inspect').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('clear')
              .setDescription('Remove all warnings for a member.')
              .addUserOption((option) =>
                option.setName('target').setDescription('Member to clear warnings for').setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove the most recent warning or a specific warning for a member.')
              .addUserOption((option) => option.setName('target').setDescription('Member to adjust').setRequired(true))
              .addIntegerOption((option) =>
                option.setName('index').setDescription('Which warning to remove (1 = most recent)').setMinValue(1)
              )
          ),
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
      'warn'
    );

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    const target = interaction.options.getMember('target');

    if (!(target instanceof GuildMember)) {
      await replyToast(interaction, 'warning', 'Cannot find that member.');
      return;
    }

    switch (sub) {
      case 'issue':
        await this.showModal(interaction, target);
        break;
      case 'history': {
        const warnings = await this.container.warnings.list(guild.id, target.id, 25);
        await interaction.reply({ embeds: [this.buildHistoryEmbed(target, warnings)], flags: MessageFlags.Ephemeral });
        break;
      }
      case 'clear': {
        await this.container.warnings.clear(guild.id, target.id);
        await replyToast(interaction, 'warning', `Cleared warnings for ${target.user.tag}.`);
        break;
      }
      case 'remove': {
        const index = interaction.options.getInteger('index') ?? 1;
        const resolution = await this.removeWarningByIndex(
          guild.id,
          target,
          index,
          interaction.user.id,
          interaction.user.tag
        );
        await interaction.reply({ embeds: [resolution.embed], flags: MessageFlags.Ephemeral });
        break;
      }
      default:
        break;
    }
  }

  public override async messageRun(message: Message, args: Args) {
    void args;
    if (!message.inGuild()) return;

    const channel = message.channel;
    if (!('send' in channel)) return;

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
    const hasPermission = await hasModerationPermission(guild, member, member.id, 'warn');

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await channel.send({ embeds: [this.buildUsageEmbed()] });
      return;
    }

    let actionToken = tokens[0]?.toLowerCase() as WarnAction | undefined;
    if (actionToken && ['issue', 'history', 'remove', 'clear'].includes(actionToken)) {
      tokens.shift();
    } else {
      actionToken = 'issue';
    }

    switch (actionToken) {
      case 'history':
        await this.handleHistory(message, tokens);
        return;
      case 'clear':
        await this.handleClear(message, tokens);
        return;
      case 'remove':
        await this.handleRemove(message, tokens);
        return;
      default:
        await this.handleWarn(message, tokens);
        return;
    }
  }

  private async handleHistory(message: Message, tokens: string[]) {
    const channel = message.channel;
    if (!('send' in channel)) return;

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }

    const warnings = await this.container.warnings.list(message.guild!.id, member.id, 25);
    await channel.send({ embeds: [this.buildHistoryEmbed(member, warnings)] });
  }

  private async handleClear(message: Message, tokens: string[]) {
    const channel = message.channel;
    if (!('send' in channel)) return;

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }

    await this.container.warnings.clear(message.guild!.id, member.id);
    await replyToast(message, 'warning', `Cleared warnings for ${member.user.tag}.`);
  }

  private async handleRemove(message: Message, tokens: string[]) {
    const channel = message.channel;
    if (!('send' in channel)) return;

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }

    const remainingTokens = tokens.slice(resolution.consumed);
    const indexToken = remainingTokens.shift();
    const index = indexToken ? Number(indexToken) : NaN;
    if (!Number.isInteger(index) || index <= 0) {
      await replyToast(message, 'warning', 'Provide the warning number you want to remove.');
      return;
    }

    const result = await this.removeWarningByIndex(
      message.guild!.id,
      member,
      index,
      message.author.id,
      message.author.tag
    );
    await channel.send({ embeds: [result.embed] });
  }

  private async handleWarn(message: Message, tokens: string[]) {
    const channel = message.channel;
    if (!('send' in channel)) return;

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }

    const remainingTokens = tokens.slice(resolution.consumed);
    const reasonInput = remainingTokens.join(' ').trim() || 'No reason provided';
    const evidence = collectEvidence({ reason: reasonInput, attachments: message.attachments });
    const cleanedInput = evidence.length
      ? reasonInput
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || reasonInput
      : reasonInput;
    const { reason, durationMs, durationLabel } = this.splitReasonAndDuration(cleanedInput);

    await this.issueWarning(message, member, reason, {
      durationMs,
      durationLabel,
      evidence,
      expiresAt: durationMs ? new Date(Date.now() + durationMs) : null
    });
  }

  private async showModal(interaction: ChatInputCommandInteraction, target: GuildMember) {
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${interaction.guild!.id}:${target.id}:${interaction.user.id}`)
      .setTitle(`Warn ${target.user.tag}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(MODAL_DURATION_ID)
            .setLabel('Duration (optional, e.g. "3 days" or "12 hours")')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );

    await interaction.showModal(modal);
  }

  public async issueWarning(
    source: ChatInputCommandInteraction | Message | ModalSubmitInteraction,
    member: GuildMember,
    reason: string,
    options: {
      durationMs?: number | null;
      durationLabel?: string | null;
      expiresAt?: Date | null;
      evidence?: string[];
    } = {}
  ): Promise<void> {
    const actor = source instanceof Message ? source.author : source.user;
    const guildId = member.guild.id;
    const durationMs = options.durationMs ?? null;
    const durationLabel = options.durationLabel ?? null;
    const expiresAt = options.expiresAt ?? (durationMs ? new Date(Date.now() + durationMs) : null);
    const evidence = options.evidence ?? [];

    // Create case (critical operation)
    const caseRecord = await this.container.cases
      .create({
        guildId,
        action: 'warn',
        targetId: member.id,
        targetTag: member.user.tag,
        moderatorId: actor.id,
        moderatorTag: actor.tag,
        reason,
        evidence,
        expiresAt
      })
      .catch(async (error) => {
        await replyToast(source, 'danger', `Failed to create case: ${(error as Error).message}`);
        return null;
      });

    if (!caseRecord) return;

    // Issue warning (fast operation)
    await this.container.warnings.issue({
      guildId,
      userId: member.id,
      moderatorId: actor.id,
      moderatorTag: actor.tag,
      reason,
      caseId: caseRecord.caseId,
      expiresAt
    });

    // RESPOND IMMEDIATELY - don't wait for DM or logs
    // Minimal sleek confirmation — small header, plain username, ID footer. No guild, no avatar, no pings.
    const warnConfirmation = buildWarnConfirmationContainer({
      caseId: caseRecord.caseId,
      username: member.user.username,
      userId: member.id,
      durationLabel,
      expiresAt,
      reason,
      evidence
    });
    await replyContainer(source, warnConfirmation);

    // Fire-and-forget: DM and logging (don't block response)
    void (async () => {
      let dmDelivered = true;

      // Ultra-minimal sleek DM — no mod, no evidence
      try {
        await member.user.send(
          v2({
            title: 'Warning',
            subtitle: `${member.guild.name} • Case #${caseRecord.caseId}`,
            accent: 'warning',
            blocks: [reason],
            footer:
              durationLabel && expiresAt
                ? `Expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R> • ${durationLabel}`
                : `Permanent • Case #${caseRecord.caseId}`
          }) as never
        );
      } catch (error) {
        dmDelivered = false;
        this.container.logger.debug({ err: error, guildId }, 'Failed to DM warned member');
      }

      // Send logs
      // WHY no channel: warn targets a member, not a message — header pills stay User • Time only.
      const durationFragment = durationLabel ? ` • Duration: ${durationLabel}` : '';
      const moderationContext = buildModerationContext({
        actor,
        target: member,
        reason,
        duration: durationLabel,
        caseId: caseRecord.caseId
      });

      const metadata: Record<string, string> = {};
      if (evidence.length) metadata.Evidence = evidence.join(', ');
      metadata['DM Delivered'] = dmDelivered ? 'Yes' : 'No';
      if (Object.keys(metadata).length) {
        moderationContext.metadata = metadata;
      }

      const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';

      try {
        await Promise.all([
          this.container.logging.sendModerationLog(
            member.guild,
            `${getEmoji('case')} Case #${caseRecord.caseId}: ${member.user.toString()} warned by ${actor.toString()}`,
            moderationContext
          ),
          this.container.logging.sendCaseLog(
            member.guild,
            `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} warned${durationFragment}${evidenceSummary}`
          )
        ]);
      } catch (error) {
        this.container.logger.error({ err: error, guildId: member.guild.id }, 'Failed to dispatch warning logs');
      }
    })();
  }

  private buildHistoryEmbed(member: GuildMember, warnings: Awaited<ReturnType<typeof this.container.warnings.list>>) {
    if (!warnings.length) {
      return createEmbed({
        description: `No warnings found for ${member.user.tag}.`,
        type: 'info'
      });
    }

    const lines = warnings.map((warning, index) => {
      const timestamp = Math.floor(new Date(warning.createdAt).getTime() / 1000);
      const expiresAt = warning.expiresAt ? Math.floor(new Date(warning.expiresAt).getTime() / 1000) : null;
      const duration = expiresAt ? ` • Expires <t:${expiresAt}:R>` : '';
      const reasonPreview = warning.reason.length > 60 ? `${warning.reason.slice(0, 57)}...` : warning.reason;
      return `**#${index + 1}** Case #${warning.caseId} • <t:${timestamp}:R>\n*${reasonPreview}*${duration}`;
    });

    return createEmbed({
      title: `${getEmoji('case')} Warnings • ${member.user.tag}`,
      description: lines.join('\n\n'),
      type: 'info',
      footer: `Use /warn remove to delete a warning`
    });
  }

  private buildUsageEmbed() {
    return createEmbed({
      title: `${getEmoji('info')} Warn command usage`,
      description: [
        '`!warn <member> [reason including optional duration]`',
        '`!warn history <member>`',
        '`!warn remove <member> <index>`',
        '`!warn clear <member>`'
      ].join('\n'),
      type: 'info'
    });
  }

  private splitReasonAndDuration(raw: string | null) {
    const fallback = 'No reason provided';
    if (!raw) {
      return { reason: fallback, durationMs: null as number | null, durationLabel: null as string | null };
    }

    const sanitized = raw.trim();
    if (!sanitized) {
      return { reason: fallback, durationMs: null as number | null, durationLabel: null as string | null };
    }

    // Optimized single-pass duration extraction
    const tokens = sanitized.split(/\s+/).filter(Boolean);

    // Try each token individually first (common case: "5m", "1h", etc.)
    for (let i = 0; i < tokens.length; i++) {
      const parsed = parseDuration(tokens[i]);
      if (parsed) {
        const reasonTokens = [...tokens.slice(0, i), ...tokens.slice(i + 1)];
        const reason = reasonTokens.join(' ').trim() || fallback;
        return { reason, durationMs: parsed.milliseconds, durationLabel: parsed.pretty };
      }
    }

    // Try two-word combinations (e.g., "5 minutes", "1 hour")
    for (let i = 0; i < tokens.length - 1; i++) {
      const parsed = parseDuration(`${tokens[i]} ${tokens[i + 1]}`);
      if (parsed) {
        const reasonTokens = [...tokens.slice(0, i), ...tokens.slice(i + 2)];
        const reason = reasonTokens.join(' ').trim() || fallback;
        return { reason, durationMs: parsed.milliseconds, durationLabel: parsed.pretty };
      }
    }

    return { reason: sanitized, durationMs: null as number | null, durationLabel: null as string | null };
  }

  private async removeWarningByIndex(
    guildId: string,
    member: GuildMember,
    index: number,
    moderatorId: string,
    moderatorTag: string
  ) {
    const position = Math.max(1, index);
    const warnings = await this.container.warnings.list(guildId, member.id, Math.max(25, position));
    if (!warnings.length) {
      return {
        embed: createEmbed({ description: `No warnings found for ${member.user.tag}.`, type: 'info' }),
        success: false
      };
    }

    const target = warnings[position - 1];
    if (!target) {
      return {
        embed: createEmbed({
          description: `Unable to find warning #${position}. ${member.user.tag} currently has ${warnings.length} warning(s).`,
          type: 'warning'
        }),
        success: false
      };
    }

    const warningId = (target as unknown as { _id: { toString(): string } })._id.toString();
    await this.container.warnings.removeById(guildId, warningId);

    const removalContext = buildModerationContext({
      target: member,
      caseId: target.caseId,
      reason: target.reason
    });
    removalContext.metadata = {
      'Moderator Tag': moderatorTag,
      'Moderator ID': moderatorId
    };

    void (async () => {
      try {
        await this.container.logging.sendModerationLog(
          member.guild,
          `${getEmoji('case')} Warning removed for ${member.user.tag}`,
          removalContext
        );
      } catch (error) {
        this.container.logger.error({ err: error, guildId: member.guild.id }, 'Failed to dispatch warning removal log');
      }
    })();

    const expiresAt = target.expiresAt ? Math.floor(new Date(target.expiresAt).getTime() / 1000) : null;
    const durationLine = expiresAt ? `Originally set to expire <t:${expiresAt}:R>.` : 'This warning was permanent.';

    return {
      embed: createEmbed({
        description: `${getEmoji('success')} Removed warning #${position} (Case #${target.caseId}) for ${member.user.tag}.
Reason: ${target.reason}
${durationLine}`,
        type: 'success'
      }),
      success: true
    };
  }
}
