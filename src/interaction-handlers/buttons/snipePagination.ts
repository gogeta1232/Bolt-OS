import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction
} from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { theme } from '../../config/theme.js';
import type { SnipedMessage, EditedMessage } from '../../services/features/snipe-service.js';

const SNIPE_ACCENT = 0x20211b;

type SnipeParsed = {
  kind: 'snipe' | 'editsnipe';
  action: 'prev' | 'next' | 'close';
  index: number;
  channelId: string;
  requesterId: string;
};

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.Button
})
export class SnipePaginationHandler extends InteractionHandler {
  public override parse(interaction: ButtonInteraction) {
    if (!interaction.isButton()) return this.none();
    const id = interaction.customId;
    if (!id.startsWith('snipe:') && !id.startsWith('editsnipe:')) return this.none();

    // Format: snipe:prev:<index>:<channelId>:<requesterId>
    //         snipe:next:<index>:<channelId>:<requesterId>
    //         snipe:close:<index>:<channelId>:<requesterId> or snipe:close:<requesterId>
    // Same for editsnipe:
    const kind: SnipeParsed['kind'] = id.startsWith('editsnipe:') ? 'editsnipe' : 'snipe';
    const stripped = id.slice(kind.length + 1); // remove "snipe:" or "editsnipe:"
    const parts = stripped.split(':');
    const action = parts[0] as SnipeParsed['action'];
    if (!['prev', 'next', 'close'].includes(action)) return this.none();

    // Handle close with variable parts
    if (action === 'close') {
      // snipe:close:<requesterId>  or snipe:close:<index>:<channelId>:<requesterId>
      if (parts.length === 2) {
        const requesterId = parts[1] ?? '';
        if (!requesterId) return this.none();
        return this.some({
          kind,
          action,
          index: 0,
          channelId: interaction.channelId ?? '',
          requesterId
        } as SnipeParsed);
      }
      const index = Number(parts[1] ?? 0);
      const channelId = parts[2] ?? interaction.channelId ?? '';
      const requesterId = parts[3] ?? '';
      if (Number.isNaN(index) || !channelId || !requesterId) return this.none();
      return this.some({ kind, action, index, channelId, requesterId } as SnipeParsed);
    }

    const index = Number(parts[1] ?? 0);
    const channelId = parts[2] ?? '';
    const requesterId = parts[3] ?? '';
    if (Number.isNaN(index) || !channelId || !requesterId) return this.none();
    return this.some({ kind, action, index, channelId, requesterId } as SnipeParsed);
  }

  public override async run(interaction: ButtonInteraction, parsed: SnipeParsed) {
    try {
      const { kind, action, index, channelId, requesterId } = parsed;

      if (interaction.user.id !== requesterId) {
        await interaction
          .reply({ content: 'Only the command user can interact with these buttons.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
      }

      const guildId = guild.id;
      const snipeService = this.container.snipe;

      if (action === 'close') {
        // Disable not clear (50006) — row.components.forEach(b=>b.disabled=true)
        const disabledRow = this.buildComponents(index, 1, channelId, requesterId, kind, true);
        // Explicit forEach disable pattern
        for (const btn of disabledRow.components) btn.setDisabled(true);
        const container = this.buildClosedContainer(kind);
        // Try container update, fallback to row disable
        await interaction
          .update({ components: [container], flags: MessageFlags.IsComponentsV2 } as never)
          .catch(async () => {
            await interaction.update({ components: [disabledRow] } as never).catch(() => {});
          });
        // Also ensure message edit disabled not clear
        await interaction.message.edit({ components: [disabledRow] } as never).catch(() => {});
        return;
      }

      // Calculate next index
      let nextIndex = index;
      const totalCount =
        kind === 'snipe'
          ? snipeService.getSnipeCount(guildId, channelId)
          : snipeService.getEditSnipeCount(guildId, channelId);
      if (action === 'prev') nextIndex = Math.max(0, index - 1);
      if (action === 'next') nextIndex = Math.min(totalCount - 1, index + 1);

      if (nextIndex === index) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }

      const target =
        kind === 'snipe'
          ? snipeService.getSnipe(guildId, channelId, nextIndex)
          : snipeService.getEditSnipe(guildId, channelId, nextIndex);
      if (!target) {
        await interaction
          .update({ content: 'No more sniped messages found.', embeds: [], components: [] } as never)
          .catch(() => {});
        return;
      }

      const updatedTotal =
        kind === 'snipe'
          ? snipeService.getSnipeCount(guildId, channelId)
          : snipeService.getEditSnipeCount(guildId, channelId);
      let embed: EmbedBuilder;
      if (kind === 'snipe') embed = this.buildSnipeEmbed(target as SnipedMessage, nextIndex, updatedTotal);
      else embed = this.buildEditSnipeEmbed(target as EditedMessage, nextIndex, updatedTotal);

      const row = this.buildComponents(nextIndex, updatedTotal, channelId, requesterId, kind, false);
      // Build V2 container with accent 0x2b2d31, Separator Small
      const container = this.buildSnipeContainer(embed, row, nextIndex, updatedTotal, kind);

      await interaction
        .update({ components: [container], flags: MessageFlags.IsComponentsV2 } as never)
        .catch(async () => {
          await interaction.update({ embeds: [embed], components: [row] } as never).catch(() => {});
        });
    } catch (error) {
      this.container.logger.debug({ err: error, customId: interaction.customId }, 'SnipePagination handler failed');
      try {
        if (interaction.replied || interaction.deferred)
          await interaction
            .followUp({ content: 'Failed to paginate snipe.', flags: MessageFlags.Ephemeral } as never)
            .catch(() => {});
        else
          await interaction
            .reply({ content: 'Failed to paginate snipe.', flags: MessageFlags.Ephemeral } as never)
            .catch(() => {});
      } catch {
        void 0;
      }
    }
  }

  private buildSnipeEmbed(snipe: SnipedMessage, currentIndex: number, totalCount: number): EmbedBuilder {
    const content = snipe.content?.trim() || '*No text content*';
    const preview = content.length > 1024 ? `${content.slice(0, 1021)}...` : content;
    const lines = [
      `### ${getEmoji('deletion')} Deleted Message`,
      ``,
      preview,
      ``,
      `-# ${getEmoji('member')} ${snipe.author.tag} • ${getEmoji('calendar')} <t:${Math.floor(snipe.timestamp / 1000)}:R>`
    ];
    if (snipe.attachments.length > 0)
      lines.push(
        ``,
        `${getEmoji('message')} │ ${snipe.attachments.length} attachment${snipe.attachments.length > 1 ? 's' : ''}`
      );
    if (snipe.embeds.length > 0)
      lines.push(`${getEmoji('message')} │ ${snipe.embeds.length} embed${snipe.embeds.length > 1 ? 's' : ''}`);
    if (snipe.stickers.length > 0)
      lines.push(`${getEmoji('sticker')} │ ${snipe.stickers.length} sticker${snipe.stickers.length > 1 ? 's' : ''}`);
    return new EmbedBuilder()
      .setColor(theme.colors.primary)
      .setAuthor({ name: snipe.author.tag, iconURL: snipe.author.avatarURL || undefined })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Snipe ${currentIndex + 1}/${totalCount}` });
  }

  private buildEditSnipeEmbed(editSnipe: EditedMessage, currentIndex: number, totalCount: number): EmbedBuilder {
    const oldPreview = editSnipe.oldContent?.trim() || '*Empty*';
    const newPreview = editSnipe.newContent?.trim() || '*Empty*';
    const oldTruncated = oldPreview.length > 512 ? `${oldPreview.slice(0, 509)}...` : oldPreview;
    const newTruncated = newPreview.length > 512 ? `${newPreview.slice(0, 509)}...` : newPreview;
    const lines = [
      `### ${getEmoji('message')} Edited Message`,
      ``,
      `**Before**`,
      oldTruncated,
      ``,
      `**After**`,
      newTruncated,
      ``,
      `-# ${getEmoji('member')} ${editSnipe.author.tag} • ${getEmoji('calendar')} <t:${Math.floor(editSnipe.editedAt / 1000)}:R>`
    ];
    return new EmbedBuilder()
      .setColor(theme.colors.warning)
      .setAuthor({ name: editSnipe.author.tag, iconURL: editSnipe.author.avatarURL || undefined })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Edit Snipe ${currentIndex + 1}/${totalCount}` });
  }

  private buildSnipeContainer(
    embed: EmbedBuilder,
    row: ActionRowBuilder<ButtonBuilder>,
    currentIndex: number,
    totalCount: number,
    kind: 'snipe' | 'editsnipe'
  ): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(SNIPE_ACCENT);
    const embedDesc = embed.data.description ?? '';
    const embedFooter = embed.data.footer?.text ?? `${kind} ${currentIndex + 1}/${totalCount}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(embedDesc));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${embedFooter}`));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    // Ensure buttons disabled not clear pattern retained
    for (const btn of row.components) {
      const disabled = btn.data.disabled ?? false;
      btn.setDisabled(disabled);
    }
    container.addActionRowComponents(row as never);
    try {
      const json = container.toJSON() as { components?: unknown[] };
      if (json.components?.length)
        (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
    } catch {
      void 0;
    }
    return container;
  }

  private buildClosedContainer(kind: 'snipe' | 'editsnipe'): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(SNIPE_ACCENT);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${getEmoji('info')} ${kind === 'snipe' ? 'Snipe' : 'Edit Snipe'} closed\n-# Session ended`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    // Disabled row added by caller; here just container
    try {
      const json = container.toJSON() as { components?: unknown[] };
      if (json.components?.length)
        (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
    } catch {
      void 0;
    }
    return container;
  }

  private buildComponents(
    currentIndex: number,
    totalCount: number,
    channelId: string,
    requesterId: string,
    kind: 'snipe' | 'editsnipe',
    disabled: boolean
  ) {
    const prefix = kind; // snipe or editsnipe
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:prev:${currentIndex}:${channelId}:${requesterId}`)
        .setLabel('‹')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentIndex === 0),
      new ButtonBuilder()
        .setCustomId(`${prefix}:close:${currentIndex}:${channelId}:${requesterId}`)
        .setLabel('×')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${prefix}:next:${currentIndex}:${channelId}:${requesterId}`)
        .setLabel('›')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentIndex === totalCount - 1)
    );
  }
}
