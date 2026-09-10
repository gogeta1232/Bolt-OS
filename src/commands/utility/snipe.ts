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
import type { SnipedMessage } from '../../services/features/snipe-service.js';

@ApplyOptions<Command.Options>({
  name: 'snipe',
  description: 'Retrieve recently deleted messages in the channel',
  enabled: true,
  requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
  runIn: ['GUILD_ANY']
})
export class SnipeCommand extends Command {
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

    await this.handleSnipe(interaction, channel.id, interaction.user.id);
  }

  public override async messageRun(message: Message) {
    await this.handleSnipe(message, message.channel.id, message.author.id);
  }

  private async handleSnipe(source: ChatInputCommandInteraction | Message, channelId: string, requesterId: string) {
    if (!source.guild) {
      await this.reply(source, {
        content: `${getEmoji('danger')} This command can only be used in servers.`,
        ephemeral: true
      });
      return;
    }

    const snipeService = this.container.snipe;
    const snipe = snipeService.getSnipe(source.guild.id, channelId, 0);

    if (!snipe) {
      await this.reply(source, {
        content: `${getEmoji('info')} No deleted messages found in this channel.`,
        ephemeral: true
      });
      return;
    }

    const snipeCount = snipeService.getSnipeCount(source.guild.id, channelId);
    await this.sendSnipeEmbed(source, snipe, 0, snipeCount, channelId, requesterId);
  }

  private async sendSnipeEmbed(
    source: ChatInputCommandInteraction | Message,
    snipe: SnipedMessage,
    currentIndex: number,
    totalCount: number,
    channelId: string,
    requesterId: string
  ) {
    const embed = this.buildSnipeEmbed(snipe, currentIndex, totalCount);
    const components = this.buildComponents(currentIndex, totalCount, channelId, requesterId);

    if (source instanceof Message) {
      if (!('send' in source.channel)) return;
      await source.channel.send({ embeds: [embed], components });
      return;
    }

    await source.reply({ embeds: [embed], components } as never);
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

    if (snipe.attachments.length > 0) {
      lines.push(
        ``,
        `${getEmoji('message')} │ ${snipe.attachments.length} attachment${snipe.attachments.length > 1 ? 's' : ''}`
      );
    }

    if (snipe.embeds.length > 0) {
      lines.push(`${getEmoji('message')} │ ${snipe.embeds.length} embed${snipe.embeds.length > 1 ? 's' : ''}`);
    }

    if (snipe.stickers.length > 0) {
      lines.push(`${getEmoji('sticker')} │ ${snipe.stickers.length} sticker${snipe.stickers.length > 1 ? 's' : ''}`);
    }

    const embed = new EmbedBuilder()
      .setColor(theme.colors.primary)
      .setAuthor({
        name: snipe.author.tag,
        iconURL: snipe.author.avatarURL || undefined
      })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Snipe ${currentIndex + 1}/${totalCount}` });

    return embed;
  }

  private buildComponents(currentIndex: number, totalCount: number, channelId: string, requesterId: string) {
    // Stateles handler snipePagination handles pagination via customId snipe:prev:index:channel:requester etc., disabled not clear to avoid 50006
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`snipe:prev:${currentIndex}:${channelId}:${requesterId}`)
          .setLabel('‹')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentIndex === 0),
        new ButtonBuilder()
          .setCustomId(`snipe:close:${currentIndex}:${channelId}:${requesterId}`)
          .setLabel('×')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`snipe:next:${currentIndex}:${channelId}:${requesterId}`)
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
