import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { ChatInputCommandInteraction, Guild, Message, Role, TextChannel, GuildMember } from 'discord.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { getEmoji } from '../../config/emojis.js';
import { createSuccessEmbed, createDangerEmbed } from '../../lib/single-line-embed.js';

const isOwner = (guild: Guild, member: GuildMember) => member.id === guild.ownerId;

@ApplyOptions<Command.Options>({
  name: 'setadminrole',
  description: 'Configure admin roles for bot access (owner-only command).',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class SetAdminRoleCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription('Configure admin roles for bot access')
          .addRoleOption((option) =>
            option.setName('role').setDescription('Role to grant or remove bot admin access').setRequired(true)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply(createDangerEmbed('This command can only be used in a server', true));
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member || !isOwner(guild, member)) {
      await interaction.reply(createDangerEmbed('Only the server owner can configure admin roles', true));
      return;
    }

    const role = interaction.options.getRole('role', true) as Role;
    const description = await this.applyRole(guild, role.id);
    await interaction.reply(createSuccessEmbed(description, true));
  }

  public override async messageRun(message: Message, args: Args) {
    const guild = message.guild;
    if (!guild) {
      await (message.channel as TextChannel).send(
        createDangerEmbed('This command can only be used in a server', false)
      );
      return;
    }

    const member = message.member;
    if (!member || !isOwner(guild, member)) {
      await (message.channel as TextChannel).send(
        createDangerEmbed('Only the server owner can configure admin roles', false)
      );
      return;
    }

    const channel = message.channel as TextChannel;
    const role = await args.pick('role').catch(() => null);
    if (!role) {
      await channel.send(createDangerEmbed('Usage: setadminrole <@role>', false));
      return;
    }

    const description = await this.applyRole(guild, (role as Role).id);
    await channel.send(createSuccessEmbed(description, false));
  }

  private async applyRole(guild: Guild, roleId: string) {
    const config = await this.container.config.fetch(guild.id);
    const roles = new Set(config.adminRoleIds);
    const isAdd = !roles.has(roleId);
    if (isAdd) roles.add(roleId);
    else roles.delete(roleId);
    await this.container.config.set(guild.id, { adminRoleIds: [...roles] });
    const role = await guild.roles.fetch(roleId);
    await this.container.logging.sendAuditLog(
      guild,
      `${isAdd ? getEmoji('embedAdd') : getEmoji('reactionRemove')} Bot admin role ${role?.toString() ?? roleId} ${isAdd ? 'granted' : 'removed'}`
    );
    const roleName = role?.name ?? roleId;
    const count = roles.size;
    return `${getEmoji('target')} **Admin Role ${isAdd ? 'Added' : 'Removed'}**\n\nRole: ${role?.toString() ?? roleName}\nTotal admin roles: ${count}\n\n${isAdd ? `${getEmoji('success')} Members with this role can now use bot admin commands.` : `${getEmoji('danger')} Members with this role can no longer use bot admin commands.`}`;
  }
}
