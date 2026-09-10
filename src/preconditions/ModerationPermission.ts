import { AllFlowsPrecondition, container } from '@sapphire/framework';
import type { ChatInputCommandInteraction, Message, Guild, GuildMember } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

export class ModerationPermissionPrecondition extends AllFlowsPrecondition {
  public override async messageRun(message: Message, _command: unknown, context: AllFlowsPrecondition.Context) {
    return this.verifyModerationAccess(message.guild, message.member as GuildMember | null, message.author.id, context);
  }

  public override async chatInputRun(
    interaction: ChatInputCommandInteraction,
    _command: unknown,
    context: AllFlowsPrecondition.Context
  ) {
    return this.verifyModerationAccess(
      interaction.guild,
      interaction.member as GuildMember | null,
      interaction.user.id,
      context
    );
  }

  public override async contextMenuRun(
    interaction: import('discord.js').ContextMenuCommandInteraction,
    _command: unknown,
    context: AllFlowsPrecondition.Context
  ) {
    return this.verifyModerationAccess(
      interaction.guild,
      interaction.member as GuildMember | null,
      interaction.user.id,
      context
    );
  }

  private async verifyModerationAccess(
    guild: Guild | null,
    guildMember: GuildMember | null,
    userId: string,
    context: AllFlowsPrecondition.Context
  ) {
    if (!guild) {
      return this.error({ message: 'This command can only be used in a server.', context });
    }

    const member = guildMember ?? (await guild.members.fetch(userId).catch(() => null));
    if (!member) return this.error({ message: 'Could not resolve your permissions.', context });

    if (guild.ownerId === userId) return this.ok();
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return this.ok();
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return this.ok();

    try {
      const config = await container.config.fetch(guild.id);
      const hasAdminRole = (config.adminRoleIds ?? []).some((roleId: string) => member.roles.cache.has(roleId));
      if (hasAdminRole) return this.ok();
    } catch {
      // Fall through to denial — config fetch failure means no admin-role grant.
    }

    return this.error({ message: 'You do not have permission to use this command.', context });
  }
}

declare module '@sapphire/framework' {
  interface Preconditions {
    ModerationPermission: never;
  }
}
