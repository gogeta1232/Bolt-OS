import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { MessageFlags, type ChatInputCommandInteraction, type Guild, type Message } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { AdminCommand } from '../../lib/structures/AdminCommand.js';

@ApplyOptions<Command.Options>({
  name: 'setwelcome',
  description: 'Configure welcome channel and message.',
  requiredClientPermissions: ['SendMessages'],
  enabled: true,
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin']
})
export class SetWelcomeCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addChannelOption((option) => option.setName('channel').setDescription('Welcome channel').setRequired(true))
          .addStringOption((option) =>
            option.setName('message').setDescription('Welcome message template').setRequired(true).setMaxLength(2_000)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    const channel = interaction.options.getChannel('channel', true);
    if (!channel || !('isTextBased' in channel) || !channel.isTextBased()) {
      await interaction.reply({
        embeds: [createEmbed({ description: 'Select a text channel.', type: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const messageTemplate = interaction.options.getString('message', true);
    const guild = interaction.guild!;
    await this.updateConfig(guild, channel.id, messageTemplate);
    await interaction.reply({
      embeds: [createEmbed({ description: `Welcome messages enabled in ${channel.toString()}`, type: 'success' })],
      flags: MessageFlags.Ephemeral
    });
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const originChannel = message.channel;
    if (!originChannel || !('send' in originChannel)) return;
    const channel = await args.pick('guildTextChannel').catch(() => null);
    if (!channel) {
      await originChannel.send({
        embeds: [createEmbed({ description: 'Tag the welcome channel first.', type: 'warning' })]
      });
      return;
    }
    const content = await args.rest('string').catch(() => null);
    if (!content || content.length > 2_000) {
      await originChannel.send({
        embeds: [
          createEmbed({ description: 'Provide a welcome message of at most 2,000 characters.', type: 'warning' })
        ]
      });
      return;
    }
    await this.updateConfig(message.guild!, channel.id, content);
    await originChannel.send({
      embeds: [createEmbed({ description: `Welcome messages enabled in ${channel.toString()}`, type: 'success' })]
    });
  }

  private async updateConfig(guild: Guild, channelId: string, messageTemplate: string) {
    await this.container.config.set(guild.id, { welcome: { channelId, message: messageTemplate } });
    const channel = await guild.channels.fetch(channelId);
    await this.container.logging.sendAuditLog(
      guild,
      `${getEmoji('welcome')} Welcome messages enabled for ${channel?.toString() ?? channelId}`
    );
  }
}
