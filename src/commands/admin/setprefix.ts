import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { MessageFlags, type ChatInputCommandInteraction, type Message } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { BotClient } from '../../lib/bot-client.js';

@ApplyOptions<Command.Options>({
  name: 'setprefix',
  description: 'Update the command prefix for this guild.',
  requiredClientPermissions: ['SendMessages'],
  enabled: true,
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin']
})
export class SetPrefixCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) => option.setName('prefix').setDescription('New command prefix').setRequired(true)),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    const rawPrefix = interaction.options.getString('prefix', true);
    const sanitized = rawPrefix.trim();
    if (!sanitized.length) {
      await interaction.reply({
        embeds: [createEmbed({ description: 'Prefix cannot be empty.', type: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (sanitized.length > 5) {
      await interaction.reply({
        embeds: [createEmbed({ description: 'Prefix must be 5 characters or fewer.', type: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const updated = await this.container.config.set(interaction.guildId!, { prefix: sanitized });
    (this.container.client as BotClient).updateGuildPrefix(interaction.guildId!, updated.prefix);
    await interaction.reply({
      embeds: [createEmbed({ description: `Prefix updated to \`${updated.prefix}\``, type: 'success' })],
      flags: MessageFlags.Ephemeral
    });
    await this.container.logging.sendAuditLog(
      interaction.guild!,
      `${getEmoji('audit')} Prefix changed to ${updated.prefix} by ${interaction.user.toString()}`
    );
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;
    const rawPrefix = await args.pick('string').catch(() => null);
    const sanitized = rawPrefix?.trim() ?? '';
    if (!sanitized.length) {
      await channel.send({ embeds: [createEmbed({ description: 'Provide a prefix to set.', type: 'warning' })] });
      return;
    }
    if (sanitized.length > 5) {
      await channel.send({
        embeds: [createEmbed({ description: 'Prefix must be 5 characters or fewer.', type: 'warning' })]
      });
      return;
    }
    const updated = await this.container.config.set(message.guild!.id, { prefix: sanitized });
    (this.container.client as BotClient).updateGuildPrefix(message.guild!.id, updated.prefix);
    await channel.send({
      embeds: [createEmbed({ description: `Prefix updated to ${updated.prefix}`, type: 'success' })]
    });
    await this.container.logging.sendAuditLog(
      message.guild!,
      `${getEmoji('audit')} Prefix changed to ${updated.prefix} by ${message.author.toString()}`
    );
  }
}
