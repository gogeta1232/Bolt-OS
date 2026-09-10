import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
  MessageFlags,
  type ChatInputCommandInteraction
} from 'discord.js';

import { theme } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import type { EditedMessage } from '../../services/features/snipe-service.js';

@ApplyOptions<Command.Options>({
  name: 'editsnipe',
  aliases: ['esnipe', 'es'],
  description: 'Retrieve recently edited messages in the channel',
  enabled: true,
  requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
  runIn: ['GUILD_ANY']
})
export class EditSnipeCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('The channel to snipe from (defaults to current)')
              .setRequired(false)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('type' in channel) || !('send' in channel)) {
      await interaction.reply({
        content: `${getEmoji('danger')} You can only snipe from text channels.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await this.handleEditSnipe(interaction, channel.id, interaction.user.id);
  }

  public override async messageRun(message: Message) {
    await this.handleEditSnipe(message, message.channel.id, message.author.id);
  }

  private async handleEditSnipe(source: ChatInputCommandInteraction | Message, channelId: string, requesterId: string) {
    if (!source.guild) {
      await this.reply(source, {
        content: `${getEmoji('danger')} This command can only be used in servers.`,
        ephemeral: true
      });
      return;
    }

    const snipeService = this.container.snipe;
    const editSnipe = snipeService.getEditSnipe(source.guild.id, channelId, 0);

    if (!editSnipe) {
      await this.reply(source, {
        content: `${getEmoji('info')} No edited messages found in this channel.`,
        ephemeral: true
      });
      return;
    }

    const snipeCount = snipeService.getEditSnipeCount(source.guild.id, channelId);
    await this.sendEditSnipeEmbed(source, editSnipe, 0, snipeCount, channelId, requesterId);
  }

  private async sendEditSnipeEmbed(
    source: ChatInputCommandInteraction | Message,
    editSnipe: EditedMessage,
    currentIndex: number,
    totalCount: number,
    channelId: string,
    requesterId: string
  ) {
    const embed = this.buildEditSnipeEmbed(editSnipe, currentIndex, totalCount);
    const components = this.buildComponents(currentIndex, totalCount, channelId, requesterId);

    if (source instanceof Message) {
      if (!('send' in source.channel)) return;
      await source.channel.send({ embeds: [embed], components });
      return;
    }

    await source.reply({ embeds: [embed], components } as never);
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

    const embed = new EmbedBuilder()
      .setColor(theme.colors.warning)
      .setAuthor({
        name: editSnipe.author.tag,
        iconURL: editSnipe.author.avatarURL || undefined
      })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Edit Snipe ${currentIndex + 1}/${totalCount}` });

    return embed;
  }

  private buildComponents(currentIndex: number, totalCount: number, channelId: string, requesterId: string) {
    // Stateles via handler snipePagination: editsnipe:prev:index:channel:requester etc., Secondary ‹ × › disabled not clear
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`editsnipe:prev:${currentIndex}:${channelId}:${requesterId}`)
          .setLabel('‹')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentIndex === 0),
        new ButtonBuilder()
          .setCustomId(`editsnipe:close:${currentIndex}:${channelId}:${requesterId}`)
          .setLabel('×')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`editsnipe:next:${currentIndex}:${channelId}:${requesterId}`)
          .setLabel('›')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentIndex === totalCount - 1)
      )
    ];
  }

  private async reply(
    source: ChatInputCommandInteraction | Message,
    options: { content: string; ephemeral?: boolean }
  ) {
    if (source instanceof Message) {
      await source.reply({ content: options.content });
    } else {
      await source.reply({
        content: options.content,
        ...(options.ephemeral ? { flags: MessageFlags.Ephemeral } : {})
      } as never);
    }
  }
}
