import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';
import type { CaseDocument } from '../../database/models/moderation/Case.js';
import { buildCasesListContainer, buildCasesNavRowHandler, CASE_COMPONENTS_FLAGS } from '../../lib/case-views.js';

const CASE_PAGE_SIZE = 7;

type CaseParsed = {
  action: 'prev' | 'next' | 'close';
  page: number;
  requesterId: string;
  mode: 'latest' | 'user' | 'moderator';
  targetId: string;
  limit: number;
};

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.Button
})
export class CasePaginationHandler extends InteractionHandler {
  public override parse(interaction: ButtonInteraction) {
    if (!interaction.isButton()) return this.none();
    if (!interaction.customId.startsWith('case:')) return this.none();
    const parts = interaction.customId.split(':');
    const action = parts[1] as CaseParsed['action'];
    if (!['prev', 'next', 'close'].includes(action)) return this.none();
    const page = Number(parts[2] ?? 0);
    const requesterId = parts[3] ?? '';
    if (!requesterId) return this.none();
    if (Number.isNaN(page)) return this.none();
    const mode = (parts[4] as CaseParsed['mode']) ?? 'latest';
    const targetId = parts[5] ?? '';
    const limit = Number(parts[6] ?? CASE_PAGE_SIZE * 3);
    return this.some({
      action,
      page,
      requesterId,
      mode: mode as CaseParsed['mode'],
      targetId,
      limit: Number.isNaN(limit) ? CASE_PAGE_SIZE * 3 : limit
    } as CaseParsed);
  }

  public override async run(interaction: ButtonInteraction, parsed: CaseParsed) {
    try {
      const { action, page, requesterId, mode, targetId, limit } = parsed;

      if (interaction.user.id !== requesterId) {
        await interaction
          .reply({ content: 'Only the requester can use these buttons.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction
          .reply({ content: 'Guild context missing.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      const member = interaction.member as import('discord.js').GuildMember | null;
      const stillHasPermission = await hasModerationPermission(
        guild,
        member as unknown as import('discord.js').GuildMember,
        interaction.user.id,
        'cases'
      );
      if (!stillHasPermission) {
        await interaction
          .reply({ content: 'You no longer have permission to view cases.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        const disabledRow = buildCasesNavRowHandler(page, 1, requesterId, mode, targetId, limit, true);
        const disabledContainer = buildCasesListContainer({
          entries: [],
          page,
          totalPages: 1,
          totalCount: 0,
          title: this.resolveTitle(mode, targetId, [], interaction),
          guildName: guild.name,
          guildIconUrl: guild.iconURL({ size: 128 }) ?? null
        });
        disabledContainer.addActionRowComponents(disabledRow as never);
        try {
          const json = disabledContainer.toJSON() as { components?: unknown[] };
          if (json.components?.length)
            (disabledContainer as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
        } catch {
          void 0;
        }
        await interaction.message
          .edit({ components: [disabledContainer], flags: CASE_COMPONENTS_FLAGS } as never)
          .catch(() => undefined);
        return;
      }

      if (action === 'close') {
        const row = buildCasesNavRowHandler(page, 1, requesterId, mode, targetId, limit, true);
        // Build a closed container — sleek minimal
        const closedContainer = buildCasesListContainer({
          entries: [],
          page,
          totalPages: 1,
          totalCount: 0,
          title: 'Cases closed',
          subtitle: 'Session ended — run /cases again to reopen',
          guildName: guild.name,
          guildIconUrl: guild.iconURL({ size: 128 }) ?? null
        });
        closedContainer.addActionRowComponents(row as never);
        try {
          const json = closedContainer.toJSON() as { components?: unknown[] };
          if (json.components?.length)
            (closedContainer as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
        } catch {
          void 0;
        }
        await interaction
          .update({ components: [closedContainer], flags: CASE_COMPONENTS_FLAGS } as never)
          .catch(() => undefined);
        try {
          for (const comp of row.components) comp.setDisabled(true);
          await interaction.message
            .edit({ components: [closedContainer], flags: CASE_COMPONENTS_FLAGS } as never)
            .catch(() => undefined);
        } catch {
          void 0;
        }
        return;
      }

      let cases: CaseDocument[] = [];
      const normalizedLimit = Math.min(Math.max(Math.floor(limit) || CASE_PAGE_SIZE * 3, CASE_PAGE_SIZE), 50);
      try {
        if (mode === 'user' && targetId) {
          cases = await this.container.cases.listForUser(guild.id, targetId, normalizedLimit);
        } else if (mode === 'moderator' && targetId) {
          cases = await this.container.cases.listForModerator(guild.id, targetId, normalizedLimit);
        } else {
          cases = await this.container.cases.latest(guild.id, normalizedLimit);
        }
      } catch (err) {
        this.container.logger.debug({ err }, 'CasePagination fetch failed');
        await interaction
          .reply({ content: 'Failed to fetch cases.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      const totalPages = Math.max(1, Math.ceil(cases.length / CASE_PAGE_SIZE));
      let nextPage = page;
      if (action === 'prev') nextPage = Math.max(0, page - 1);
      if (action === 'next') nextPage = Math.min(totalPages - 1, page + 1);

      const pageSlice = cases.slice(nextPage * CASE_PAGE_SIZE, (nextPage + 1) * CASE_PAGE_SIZE);
      const title = this.resolveTitle(mode, targetId, cases, interaction);
      const guildIconUrl = guild.iconURL({ size: 128 }) ?? null;

      const container = buildCasesListContainer({
        entries: pageSlice,
        page: nextPage,
        totalPages,
        totalCount: cases.length,
        title,
        guildName: guild.name,
        guildIconUrl
      });
      const row = buildCasesNavRowHandler(nextPage, totalPages, requesterId, mode, targetId, normalizedLimit);
      container.addActionRowComponents(row as never);
      try {
        const json = container.toJSON() as { components?: unknown[] };
        if (json.components?.length)
          (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
      } catch {
        void 0;
      }

      await interaction.update({ components: [container], flags: CASE_COMPONENTS_FLAGS } as never).catch(async () => {
        // Fallback — rebuild without sleek wrapper if V2 fails
        const fallbackRow = buildCasesNavRowHandler(nextPage, totalPages, requesterId, mode, targetId, normalizedLimit);
        await interaction
          .update({ components: [container], flags: CASE_COMPONENTS_FLAGS } as never)
          .catch(() => undefined);
        void fallbackRow;
      });
    } catch (error) {
      this.container.logger.error({ err: error, customId: interaction.customId }, 'CasePagination handler failed');
      try {
        if (interaction.replied || interaction.deferred)
          await interaction
            .followUp({ content: 'Failed to paginate.', flags: MessageFlags.Ephemeral } as never)
            .catch(() => {});
        else
          await interaction
            .reply({ content: 'Failed to paginate.', flags: MessageFlags.Ephemeral } as never)
            .catch(() => {});
      } catch {
        void 0;
      }
    }
  }

  private resolveTitle(mode: string, targetId: string, cases: CaseDocument[], _interaction: ButtonInteraction): string {
    void _interaction;
    if (mode === 'user') {
      const tag = cases[0]?.targetTag ?? targetId;
      return `Cases for ${tag}`;
    }
    if (mode === 'moderator') {
      const tag = cases[0]?.moderatorTag ?? targetId;
      return `Cases moderated by ${tag}`;
    }
    return 'Latest Cases';
  }
}
