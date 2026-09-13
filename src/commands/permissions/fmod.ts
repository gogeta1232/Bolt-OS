import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { ChatInputCommandInteraction, Guild, Message, Role, TextChannel } from 'discord.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { getEmoji } from '../../config/emojis.js';
import { createSuccessEmbed, createDangerEmbed } from '../../lib/single-line-embed.js';

@ApplyOptions<Command.Options>({
  name: 'fmod',
  description: 'Grant or revoke the Bolt mod key on a role (owner and admins).',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class FmodCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription('Grant or revoke the Bolt mod key on a role')
          .addRoleOption((option) =>
            option.setName('role').setDescription('Role to grant or remove mod access').setRequired(true)
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

    await this.ensureAdmin(interaction);
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

    await this.ensureAdmin(message);
    const channel = message.channel as TextChannel;
    const role = await args.pick('role').catch(() => null);
    if (!role) {
      await channel.send(createDangerEmbed('Usage: fmod <@role>', false));
      return;
    }

    const description = await this.applyRole(guild, (role as Role).id);
    await channel.send(createSuccessEmbed(description, false));
  }

  private async applyRole(guild: Guild, roleId: string) {
    const config = await this.container.config.fetch(guild.id);
    const roles = new Set(config.modRoleIds ?? []);
    const isAdd = !roles.has(roleId);
    if (isAdd) roles.add(roleId);
    else roles.delete(roleId);
    await this.container.config.set(guild.id, { modRoleIds: [...roles] });
    const role = await guild.roles.fetch(roleId);
    await this.container.logging.sendAuditLog(
      guild,
      `${isAdd ? getEmoji('embedAdd') : getEmoji('reactionRemove')} Bot mod role ${role?.toString() ?? roleId} ${isAdd ? 'granted' : 'removed'}`
    );
    const roleName = role?.name ?? roleId;
    const count = roles.size;
    return `${getEmoji('target')} **Mod Key ${isAdd ? 'Granted' : 'Revoked'}**\n\nRole: ${role?.toString() ?? roleName}\nTotal mod roles: ${count}\n\n${isAdd ? `${getEmoji('success')} Holders can use moderation commands. No admin surface, no grants.` : `${getEmoji('danger')} Holders lose moderation access.`}`;
  }
}
