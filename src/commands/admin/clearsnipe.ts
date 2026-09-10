import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';

@ApplyOptions<Command.Options>({
  name: 'clearsnipe',
  aliases: ['purgesnipe', 'snipeclear'],
  description: 'Clear snipe cache for a channel or entire server.',
  requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
  requiredUserPermissions: ['ManageMessages'],
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin']
})
export class ClearSnipeCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addSubcommand((sub) =>
            sub
              .setName('channel')
              .setDescription('Clear snipe cache for a specific channel')
              .addChannelOption((option) =>
                option.setName('target').setDescription('Channel to clear (defaults to current)').setRequired(false)
              )
          )
          .addSubcommand((sub) => sub.setName('server').setDescription('Clear ALL snipe cache for this server')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        embeds: [
          createEmbed({
            description: 'This command can only be used in guilds.',
            type: 'warning'
          })
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'server') {
      await this.handleClearServer(interaction);
    } else {
      await this.handleClearChannel(interaction);
    }
  }

  public override async messageRun(message: Message) {
    if (!message.guild) return;

    const args = message.content.trim().split(/\s+/).slice(1);
    const action = args[0]?.toLowerCase();

    if (action === 'server' || action === 'all') {
      await this.handleClearServerMessage(message);
    } else {
      await this.handleClearChannelMessage(message);
    }
  }

  private async handleClearChannel(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    const channel = interaction.options.getChannel('target') ?? interaction.channel;
    const snipeCount = this.container.snipe.getSnipeCount(interaction.guild.id, channel!.id);
    const editCount = this.container.snipe.getEditSnipeCount(interaction.guild.id, channel!.id);
    const total = snipeCount + editCount;

    if (total === 0) {
      await interaction.reply({
        embeds: [
          createEmbed({
            description: 'No snipe cache found for this channel.',
            type: 'info'
          })
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    this.container.snipe.clearChannelSnipes(interaction.guild.id, channel!.id);

    await interaction.reply({
      embeds: [
        createEmbed({
          type: 'success',
          description: [
            `### ${getEmoji('success')} Snipe Cache Cleared`,
            ``,
            `${getEmoji('deletion')} │ **${total}** cached messages removed`,
            `${getEmoji('message')} │ ${snipeCount} deleted, ${editCount} edited`,
            ``,
            `-# <#${channel!.id}>`
          ].join('\n'),
          styled: false
        }).setTimestamp()
      ]
    });

    this.container.logger.info(
      {
        guildId: interaction.guild.id,
        channelId: channel!.id,
        adminId: interaction.user.id,
        cleared: total
      },
      'Admin cleared channel snipe cache'
    );
  }

  private async handleClearServer(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    this.container.snipe.clearGuildSnipes(interaction.guild.id);

    await interaction.reply({
      embeds: [
        createEmbed({
          type: 'success',
          description: [
            `### ${getEmoji('success')} All Snipe Cache Cleared`,
            ``,
            `${getEmoji('deletion')} │ Removed all cached messages for this server`,
            ``,
            `-# ${getEmoji('warning')} This action cannot be undone`
          ].join('\n'),
          styled: false
        }).setTimestamp()
      ]
    });

    this.container.logger.warn(
      {
        guildId: interaction.guild.id,
        adminId: interaction.user.id
      },
      'Admin cleared all server snipe cache'
    );
  }

  private async handleClearChannelMessage(message: Message) {
    if (!message.guild) return;

    const snipeCount = this.container.snipe.getSnipeCount(message.guild.id, message.channel.id);
    const editCount = this.container.snipe.getEditSnipeCount(message.guild.id, message.channel.id);
    const total = snipeCount + editCount;

    if (total === 0) {
      await message.reply({
        embeds: [
          createEmbed({
            description: 'No snipe cache found for this channel.',
            type: 'info'
          })
        ]
      });
      return;
    }

    this.container.snipe.clearChannelSnipes(message.guild.id, message.channel.id);

    await message.reply({
      embeds: [
        createEmbed({
          type: 'success',
          description: [
            `### ${getEmoji('success')} Snipe Cache Cleared`,
            ``,
            `${getEmoji('deletion')} │ **${total}** cached messages removed`,
            `${getEmoji('message')} │ ${snipeCount} deleted, ${editCount} edited`
          ].join('\n'),
          styled: false
        }).setTimestamp()
      ]
    });

    this.container.logger.info(
      {
        guildId: message.guild.id,
        channelId: message.channel.id,
        adminId: message.author.id,
        cleared: total
      },
      'Admin cleared channel snipe cache'
    );
  }

  private async handleClearServerMessage(message: Message) {
    if (!message.guild) return;

    this.container.snipe.clearGuildSnipes(message.guild.id);

    await message.reply({
      embeds: [
        createEmbed({
          type: 'success',
          description: [
            `### ${getEmoji('success')} All Snipe Cache Cleared`,
            ``,
            `${getEmoji('deletion')} │ Removed all cached messages for this server`,
            ``,
            `-# ${getEmoji('warning')} This action cannot be undone`
          ].join('\n'),
          styled: false
        }).setTimestamp()
      ]
    });

    this.container.logger.warn(
      {
        guildId: message.guild.id,
        adminId: message.author.id
      },
      'Admin cleared all server snipe cache'
    );
  }
}
