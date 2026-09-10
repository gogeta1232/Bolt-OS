import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { ChannelType, Message, MessageFlags, PermissionFlagsBits, TextChannel } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { AdminCommand } from '../../lib/structures/AdminCommand.js';

@ApplyOptions<Command.Options>({
  name: 'setjailchannel',
  description: 'Set the channel to limit jailed members to.',
  requiredClientPermissions: ['SendMessages'],
  enabled: true,
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin'],
  requiredUserPermissions: [PermissionFlagsBits.ManageGuild]
})
export class SetJailChannelCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel to limit jailed members to')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
              .setRequired(true)
          )
          .addBooleanOption((option) => option.setName('show').setDescription('Show current jail channel settings')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    const show = interaction.options.getBoolean('show') ?? false;

    if (show) {
      const config = await this.container.config.fetch(interaction.guildId!);
      const jailChannel = config.jailChannelId ? interaction.guild!.channels.cache.get(config.jailChannelId) : null;

      const description = `**Jail Channel:** ${jailChannel ? jailChannel.toString() : 'Not set'}`;

      await interaction.reply({
        embeds: [
          createEmbed({
            title: `${getEmoji('settings')} Jail Channel Settings`,
            description,
            type: 'info'
          })
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    await this.container.config.set(interaction.guildId!, { jailChannelId: channel.id });
    await interaction.reply({
      embeds: [createEmbed({ description: `Jail channel updated to ${channel.toString()}`, type: 'success' })],
      flags: MessageFlags.Ephemeral
    });
    await this.container.logging.sendAuditLog(
      interaction.guild!,
      `${getEmoji('audit')} Jail channel changed to ${channel.toString()} by ${interaction.user.toString()}`
    );
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const show = await args
      .pick('string')
      .then((str) => str === 'show')
      .catch(() => false);

    if (show) {
      const config = await this.container.config.fetch(message.guild!.id);
      const jailChannel = config.jailChannelId ? message.guild!.channels.cache.get(config.jailChannelId) : null;

      const description = `**Jail Channel:** ${jailChannel ? jailChannel.toString() : 'Not set'}`;

      await channel.send({
        embeds: [
          createEmbed({
            title: `${getEmoji('settings')} Jail Channel Settings`,
            description,
            type: 'info'
          })
        ]
      });
      return;
    }

    const rawChannel = await args.rest('string').catch(() => null);
    if (!rawChannel) {
      await channel.send({
        embeds: [createEmbed({ description: 'Provide a channel to set as the jail channel.', type: 'warning' })]
      });
      return;
    }

    // Try to resolve the channel from mentions or by ID
    let resolvedChannel: TextChannel | undefined;
    if (message.mentions.channels.size > 0) {
      resolvedChannel = message.mentions.channels.first() as TextChannel | undefined;
    } else if (/^\d{17,19}$/.test(rawChannel)) {
      // If it's a snowflake ID, try to fetch it
      resolvedChannel = message.guild?.channels.cache.get(rawChannel) as TextChannel | undefined;
    } else {
      // Try to find by name (case-insensitive)
      resolvedChannel = message.guild?.channels.cache.find(
        (c) =>
          (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice) &&
          c.name.toLowerCase() === rawChannel.toLowerCase()
      ) as TextChannel | undefined;
    }

    if (!resolvedChannel) {
      await channel.send({ embeds: [createEmbed({ description: 'Could not find that channel.', type: 'warning' })] });
      return;
    }

    await this.container.config.set(message.guild!.id, { jailChannelId: resolvedChannel.id });
    await channel.send({
      embeds: [createEmbed({ description: `Jail channel updated to ${resolvedChannel.toString()}`, type: 'success' })]
    });
    await this.container.logging.sendAuditLog(
      message.guild!,
      `${getEmoji('audit')} Jail channel changed to ${resolvedChannel.toString()} by ${message.author.toString()}`
    );
  }
}
