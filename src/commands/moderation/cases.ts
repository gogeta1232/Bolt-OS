import { randomUUID } from 'node:crypto';
import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import {
  GuildMember,
  Message,
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction
} from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import type { CaseDocument } from '../../database/models/moderation/Case.js';
import {
  buildCaseDetailContainer,
  buildCasesListContainer,
  buildCasesNavRowCollector,
  CASE_COMPONENTS_FLAGS
} from '../../lib/case-views.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

const CASE_PAGE_SIZE = 7;
const DEFAULT_CASE_FETCH_LIMIT = CASE_PAGE_SIZE * 3;

@ApplyOptions<Command.Options>({
  name: 'cases',
  description: 'View moderation cases for this guild.',
  requiredClientPermissions: ['SendMessages'],
  runIn: ['GUILD_ANY'],
  fullCategory: ['moderation'],
  aliases: ['case', 'Cases', 'CASES']
})
export class CasesCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('latest')
              .setDescription('View the latest moderation cases.')
              .addIntegerOption((option) =>
                option
                  .setName('limit')
                  .setDescription('Number of cases to view (max 20).')
                  .setMinValue(1)
                  .setMaxValue(20)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('view')
              .setDescription('View a specific case by its ID.')
              .addIntegerOption((option) =>
                option.setName('id').setDescription('Case ID to view').setRequired(true).setMinValue(1)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('update')
              .setDescription('Update a case you originally created.')
              .addIntegerOption((option) =>
                option.setName('id').setDescription('Case ID to update').setRequired(true).setMinValue(1)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Replace the case reason'))
              .addAttachmentOption((option) =>
                option.setName('evidence').setDescription('Attach new evidence (optional)')
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('user')
              .setDescription('View cases for a specific member.')
              .addUserOption((option) =>
                option.setName('target').setDescription('Member to view cases for').setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName('limit')
                  .setDescription('Number of cases to view (max 20).')
                  .setMinValue(1)
                  .setMaxValue(20)
              )
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await replyGuildOnly(interaction);
      return;
    }

    const hasPermission = await hasModerationPermission(
      interaction.guild,
      interaction.member as GuildMember,
      interaction.user.id,
      'cases'
    );
    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'view': {
        const caseId = interaction.options.getInteger('id', true);
        await this.respondWithCase(interaction, interaction.guild.id, caseId);
        break;
      }
      case 'update': {
        const caseId = interaction.options.getInteger('id', true);
        const reason = interaction.options.getString('reason');
        const evidenceAttachment = interaction.options.getAttachment('evidence');
        const newEvidence = evidenceAttachment ? [evidenceAttachment.url] : [];
        await this.performCaseUpdate(interaction, interaction.guild.id, caseId, reason, newEvidence);
        break;
      }
      case 'user': {
        const target = interaction.options.getUser('target', true);
        const limit = interaction.options.getInteger('limit') ?? undefined;
        await this.respondWithUserCases(interaction, interaction.guild.id, target.id, limit);
        break;
      }
      case 'latest':
      default: {
        const limit = interaction.options.getInteger('limit') ?? undefined;
        await this.respondWithLatest(interaction, interaction.guild.id, limit);
        break;
      }
    }
  }

  public override async messageRun(message: Message) {
    if (!message.guild) return;

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const hasPermission = await hasModerationPermission(message.guild, member, member.id, 'cases');
    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const [, rawSub, ...rest] = message.content.trim().split(/\s+/);
    if (!rawSub) {
      await this.respondWithModeratorCases(message, message.guild.id, message.author.id);
      return;
    }

    const sub = rawSub.toLowerCase();

    if (sub === 'update') {
      const idToken = rest.shift();
      const caseId = idToken ? Number.parseInt(idToken, 10) : Number.NaN;
      if (Number.isNaN(caseId)) {
        await replyToast(message, 'warning', 'Please supply a valid case ID to update.');
        return;
      }
      const reason = rest.join(' ').trim() || null;
      const evidence = Array.from(message.attachments.values()).map((attachment) => attachment.url);
      await this.performCaseUpdate(message, message.guild.id, caseId, reason, evidence);
      return;
    }

    if (sub === 'view' || sub === 'case') {
      const idToken = rest.shift();
      const caseId = idToken ? Number.parseInt(idToken, 10) : Number.NaN;
      if (Number.isNaN(caseId)) {
        await replyToast(message, 'warning', 'Please supply a valid case ID.');
        return;
      }
      await this.respondWithCase(message, message.guild.id, caseId);
      return;
    }

    if (/^\d+$/.test(sub)) {
      const caseId = Number.parseInt(sub, 10);
      await this.respondWithCase(message, message.guild.id, caseId);
      return;
    }

    if (sub === 'user' || sub === 'member') {
      const mention = rest.shift();
      if (!mention) {
        await replyToast(message, 'warning', 'Please provide a user mention or ID.');
        return;
      }
      const userId = this.extractId(mention);
      if (!userId) {
        await replyToast(message, 'warning', 'Invalid user specified.');
        return;
      }
      const limitToken = rest.shift();
      const parsedLimit = limitToken ? Number.parseInt(limitToken, 10) : Number.NaN;
      await this.respondWithUserCases(
        message,
        message.guild.id,
        userId,
        Number.isNaN(parsedLimit) ? undefined : parsedLimit
      );
      return;
    }

    if (sub === 'latest') {
      const limitToken = rest.shift();
      const parsedLimit = limitToken ? Number.parseInt(limitToken, 10) : Number.NaN;
      await this.respondWithLatest(message, message.guild.id, Number.isNaN(parsedLimit) ? undefined : parsedLimit);
      return;
    }

    const mentionedModeratorId = this.extractId(rawSub);
    if (mentionedModeratorId) {
      const limitToken = rest.shift();
      const parsedLimit = limitToken ? Number.parseInt(limitToken, 10) : Number.NaN;
      await this.respondWithModeratorCases(
        message,
        message.guild.id,
        mentionedModeratorId,
        Number.isNaN(parsedLimit) ? undefined : parsedLimit
      );
      return;
    }

    await this.respondWithModeratorCases(message, message.guild.id, message.author.id);
  }

  private async respondWithCase(source: ChatInputCommandInteraction | Message, guildId: string, caseId: number) {
    const caseData = await this.container.cases.fetch(guildId, caseId);
    if (!caseData) {
      await replyToast(source, 'warning', `Case #${caseId} was not found.`);
      return;
    }

    const guild = source instanceof Message ? source.guild : source.guild;
    const guildInfo = guild ? { name: guild.name, iconURL: guild.iconURL({ size: 128 }) } : null;
    const container = buildCaseDetailContainer(caseData, guildInfo);

    if (source instanceof Message) {
      await source.reply({ components: [container], flags: CASE_COMPONENTS_FLAGS });
    } else if (source.deferred || source.replied) {
      await source.followUp({ components: [container], flags: CASE_COMPONENTS_FLAGS | MessageFlags.Ephemeral });
    } else {
      await source.reply({ components: [container], flags: CASE_COMPONENTS_FLAGS | MessageFlags.Ephemeral });
    }
  }

  private normalizeCaseLimit(limit?: number) {
    if (limit === undefined || Number.isNaN(limit) || limit <= 0) {
      return DEFAULT_CASE_FETCH_LIMIT;
    }

    const floored = Math.floor(limit);
    return Math.min(Math.max(floored, CASE_PAGE_SIZE), 50);
  }

  private async respondWithUserCases(
    source: ChatInputCommandInteraction | Message,
    guildId: string,
    userId: string,
    limit?: number
  ) {
    const normalizedLimit = this.normalizeCaseLimit(limit);
    const cases = await this.container.cases.listForUser(guildId, userId, normalizedLimit);
    if (cases.length === 0) {
      await replyToast(source, 'info', 'No cases found for that user.');
      return;
    }
    await this.sendCaseCarousel(source, cases, {
      title: `Cases for ${cases[0]?.targetTag ?? userId}`
    });
  }

  private async respondWithModeratorCases(
    source: ChatInputCommandInteraction | Message,
    guildId: string,
    moderatorId: string,
    limit?: number
  ) {
    const normalizedLimit = this.normalizeCaseLimit(limit);
    const cases = await this.container.cases.listForModerator(guildId, moderatorId, normalizedLimit);
    if (cases.length === 0) {
      const moderatorLabel = this.resolveUserLabel(source, moderatorId);
      await replyToast(source, 'info', `No cases found for ${moderatorLabel}.`);
      return;
    }

    const moderatorTag = cases[0]?.moderatorTag ?? this.resolveUserLabel(source, moderatorId);
    await this.sendCaseCarousel(source, cases, {
      title: `Cases moderated by ${moderatorTag}`
    });
  }

  private async sendCaseCarousel(
    source: ChatInputCommandInteraction | Message,
    cases: CaseDocument[],
    options: { title: string }
  ) {
    const pages: CaseDocument[][] = [];
    for (let i = 0; i < cases.length; i += CASE_PAGE_SIZE) {
      pages.push(cases.slice(i, i + CASE_PAGE_SIZE));
    }

    const sessionId = randomUUID();
    let pageIndex = 0;
    const totalPages = pages.length;
    const requesterId = source instanceof Message ? source.author.id : source.user.id;
    const totalCount = cases.length;
    const guild = source instanceof Message ? source.guild : source.guild;
    const guildName = guild?.name;
    const guildIconUrl = guild?.iconURL({ size: 128 }) ?? null;

    const buildContainer = (page: number, disabled = false) => {
      const entries = pages[page] ?? [];
      const container = buildCasesListContainer({
        entries,
        page,
        totalPages,
        totalCount,
        title: options.title,
        guildName,
        guildIconUrl
      });
      if (totalPages > 1) {
        const row = buildCasesNavRowCollector(sessionId, page, totalPages, disabled);
        container.addActionRowComponents(row as never);
        try {
          const json = container.toJSON() as { components?: unknown[] };
          if (json.components?.length)
            (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
        } catch {
          void 0;
        }
      }
      return container;
    };

    const initialContainer = buildContainer(pageIndex);
    let message: Message;

    if (source instanceof Message) {
      message = await source.reply({ components: [initialContainer], flags: CASE_COMPONENTS_FLAGS });
    } else if (source.deferred) {
      message = await source.editReply({ components: [initialContainer], flags: CASE_COMPONENTS_FLAGS });
    } else if (source.replied) {
      message = await source.followUp({ components: [initialContainer], flags: CASE_COMPONENTS_FLAGS });
    } else {
      await source.reply({ components: [initialContainer], flags: CASE_COMPONENTS_FLAGS });
      message = await source.fetchReply();
    }

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', (interaction: MessageComponentInteraction) => {
      void (async () => {
        if (!interaction.customId.startsWith(sessionId)) return;

        if (interaction.user.id !== requesterId) {
          await interaction.reply({
            content: 'Only the requester can use these buttons.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const g = interaction.guild;
        const member = interaction.member as GuildMember | null;
        const stillHasPermissions =
          g && member ? await hasModerationPermission(g, member, interaction.user.id, 'cases') : false;

        if (!stillHasPermissions) {
          await interaction.reply({
            content: 'You no longer have permission to view cases.',
            flags: MessageFlags.Ephemeral
          });
          const disabledContainer = buildContainer(pageIndex, true);
          await interaction.message
            .edit({ components: [disabledContainer], flags: CASE_COMPONENTS_FLAGS } as never)
            .catch(() => undefined);
          collector.stop();
          return;
        }

        const action = interaction.customId.split(':')[1];
        if (action === 'prev') {
          if (pageIndex <= 0) {
            await interaction.deferUpdate();
            return;
          }
          pageIndex -= 1;
        } else if (action === 'next') {
          if (pageIndex >= totalPages - 1) {
            await interaction.deferUpdate();
            return;
          }
          pageIndex += 1;
        } else if (action === 'stop') {
          const disabledContainer = buildContainer(pageIndex, true);
          await interaction.update({ components: [disabledContainer], flags: CASE_COMPONENTS_FLAGS } as never);
          collector.stop();
          return;
        }

        const updatedContainer = buildContainer(pageIndex);
        await interaction.update({ components: [updatedContainer], flags: CASE_COMPONENTS_FLAGS } as never);
      })();
    });

    collector.on('end', () => {
      void message
        .edit({ components: [buildContainer(pageIndex, true)], flags: CASE_COMPONENTS_FLAGS } as never)
        .catch((error) => this.container.logger.debug({ err: error }, 'Failed to disable case navigation buttons'));
    });
  }

  private async respondWithLatest(source: ChatInputCommandInteraction | Message, guildId: string, limit?: number) {
    const normalizedLimit = this.normalizeCaseLimit(limit);
    const cases = await this.container.cases.latest(guildId, normalizedLimit);
    if (cases.length === 0) {
      await replyToast(source, 'info', 'No cases found for this guild.');
      return;
    }
    await this.sendCaseCarousel(source, cases, {
      title: 'Latest Cases'
    });
  }

  private async performCaseUpdate(
    source: ChatInputCommandInteraction | Message,
    guildId: string,
    caseId: number,
    reasonInput: string | null,
    evidence: string[]
  ) {
    const actor = source instanceof Message ? source.author : source.user;
    const guild = source instanceof Message ? source.guild : source.guild;
    if (!guild) {
      await replyToast(source, 'danger', 'Guild context unavailable.');
      return;
    }

    const caseData = await this.container.cases.fetch(guildId, caseId);
    if (!caseData) {
      await replyToast(source, 'warning', `Case #${caseId} was not found.`);
      return;
    }

    if (caseData.moderatorId !== actor.id) {
      await replyToast(source, 'warning', 'Only the moderator who created this case can update it.');
      return;
    }

    const sanitizedReason = reasonInput?.trim() ?? '';
    const newReason = sanitizedReason.length > 0 ? sanitizedReason : null;
    const newEvidence = evidence.filter(Boolean);
    const combinedEvidence = newEvidence.length
      ? Array.from(new Set([...caseData.evidence, ...newEvidence]))
      : caseData.evidence;
    const addedEvidence = combinedEvidence.filter((item) => !caseData.evidence.includes(item));

    if (!newReason && addedEvidence.length === 0) {
      await replyToast(source, 'warning', 'Provide a new reason or attach new evidence to update the case.');
      return;
    }

    const updated = await this.container.cases.update({
      guildId,
      caseId,
      moderatorId: actor.id,
      reason: newReason ?? undefined,
      evidence: addedEvidence.length ? combinedEvidence : undefined
    });

    if (!updated) {
      await replyToast(source, 'danger', 'Failed to update the case. Try again shortly.');
      return;
    }

    const summaryLines = [
      `${getEmoji('success')} Updated case #${updated.caseId}.`,
      newReason ? `→ Reason: ${updated.reason}` : '→ Reason left unchanged.'
    ];
    if (addedEvidence.length) {
      summaryLines.push(`→ Evidence added: ${addedEvidence.map((item) => `[link](${item})`).join(', ')}`);
    }

    await replyToast(source, 'success', summaryLines.join('\n'));

    const logFragments = [
      `${getEmoji('case')} Case #${updated.caseId} updated by ${actor.tag}`,
      newReason ? `Reason: ${updated.reason}` : null,
      addedEvidence.length ? `Evidence +${addedEvidence.length}` : null
    ].filter(Boolean);

    const logContext = buildModerationContext({
      actor,
      target: null,
      reason: newReason ?? undefined,
      caseId: updated.caseId
    });
    if (addedEvidence.length) {
      logContext.metadata = {
        'Evidence Added': addedEvidence.length
      };
    }

    await this.container.logging.sendModerationLog(guild, logFragments.join(' • '), logContext);
    await this.container.logging.sendCaseLog(
      guild,
      `${getEmoji('case')} Case #${updated.caseId} updated by ${actor.tag}${addedEvidence.length ? ` • +${addedEvidence.length} evidence` : ''}`
    );
  }

  private extractId(input: string) {
    const mentionMatch = /^(?:<@!?)(\d+)>$/.exec(input);
    if (mentionMatch) return mentionMatch[1];
    return /^\d{5,}$/.test(input) ? input : null;
  }

  private resolveUserLabel(source: ChatInputCommandInteraction | Message, userId: string) {
    const cachedUser = source.client.users.cache.get(userId);
    if (cachedUser) {
      return cachedUser.tag;
    }

    const member = source.guild?.members.cache.get(userId);
    if (member) {
      return member.user.tag;
    }

    return `<@${userId}>`;
  }
}
