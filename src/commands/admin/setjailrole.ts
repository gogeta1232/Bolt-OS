import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message, MessageFlags, PermissionFlagsBits, Role } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { AdminCommand } from '../../lib/structures/AdminCommand.js';

@ApplyOptions<Command.Options>({
  name: 'setjailrole',
  description: 'Configure the jail role and view jail settings.',
  requiredClientPermissions: ['SendMessages'],
  enabled: true,
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin'],
  requiredUserPermissions: [PermissionFlagsBits.ManageGuild]
})
export class SetJailRoleCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('role')
              .setDescription('Set the role used for jailing members')
              .addRoleOption((option) =>
                option.setName('role').setDescription('Role to use for jailing members').setRequired(true)
              )
          )
          .addSubcommand((sub) => sub.setName('show').setDescription('Show current jail role and channel settings')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'role') {
      const role = interaction.options.getRole('role', true) as Role;
      await this.container.config.set(interaction.guildId!, { jailRoleId: role.id });
      await interaction.reply({
        embeds: [createEmbed({ description: `Jail role updated to ${role.toString()}`, type: 'success' })],
        flags: MessageFlags.Ephemeral
      });
      await this.container.logging.sendAuditLog(
        interaction.guild!,
        `${getEmoji('audit')} Jail role changed to ${role.toString()} by ${interaction.user.toString()}`
      );
    } else if (subcommand === 'show') {
      const config = await this.container.config.fetch(interaction.guildId!);
      const jailRole = config.jailRoleId ? interaction.guild!.roles.cache.get(config.jailRoleId) : null;
      const jailChannel = config.jailChannelId ? interaction.guild!.channels.cache.get(config.jailChannelId) : null;

      const description = [
        `**Jail Role:** ${jailRole ? jailRole.toString() : 'Not set'}`,
        `**Jail Channel:** ${jailChannel ? jailChannel.toString() : 'Not set'}`
      ].join('\n');

      await interaction.reply({
        embeds: [
          createEmbed({
            title: `${getEmoji('settings')} Jail Settings`,
            description,
            type: 'info'
          })
        ],
        flags: MessageFlags.Ephemeral
      });
    }
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const subcommand = await args.pick('string').catch(() => 'show');

    if (subcommand === 'role') {
      const rawRole = await args.rest('string').catch(() => null);
      if (!rawRole) {
        await channel.send({
          embeds: [createEmbed({ description: 'Provide a role to set as the jail role.', type: 'warning' })]
        });
        return;
      }

      // Try to resolve the role from mentions or by ID
      let role: Role | undefined;
      if (message.mentions.roles.size > 0) {
        role = message.mentions.roles.first();
      } else if (/^\d{17,19}$/.test(rawRole)) {
        // If it's a snowflake ID, try to fetch it
        role = message.guild?.roles.cache.get(rawRole);
      } else {
        // Try to find by name (case-insensitive)
        role = message.guild?.roles.cache.find((r) => r.name.toLowerCase() === rawRole.toLowerCase());
      }

      if (!role) {
        await channel.send({ embeds: [createEmbed({ description: 'Could not find that role.', type: 'warning' })] });
        return;
      }

      await this.container.config.set(message.guild!.id, { jailRoleId: role.id });
      await channel.send({
        embeds: [createEmbed({ description: `Jail role updated to ${role.toString()}`, type: 'success' })]
      });
      await this.container.logging.sendAuditLog(
        message.guild!,
        `${getEmoji('audit')} Jail role changed to ${role.toString()} by ${message.author.toString()}`
      );
    } else {
      // Show current settings for any other subcommand (including 'show' or default)
      const config = await this.container.config.fetch(message.guild!.id);
      const jailRole = config.jailRoleId ? message.guild!.roles.cache.get(config.jailRoleId) : null;
      const jailChannel = config.jailChannelId ? message.guild!.channels.cache.get(config.jailChannelId) : null;

      const description = [
        `**Jail Role:** ${jailRole ? jailRole.toString() : 'Not set'}`,
        `**Jail Channel:** ${jailChannel ? jailChannel.toString() : 'Not set'}`
      ].join('\n');

      await channel.send({
        embeds: [
          createEmbed({
            title: `${getEmoji('settings')} Jail Settings`,
            description,
            type: 'info'
          })
        ]
      });
    }
  }
}
