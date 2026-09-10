import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, type Role, type Guild, Message, MessageFlags } from 'discord.js';
import Fuse from 'fuse.js';

import { v2 } from '../../lib/embeds.js';

@ApplyOptions<Command.Options>({
  name: 'roleinfo',
  aliases: ['ri', 'role', 'r'],
  description: "Inspect a role's information and permissions.",
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class RoleInfoCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addRoleOption((option) => option.setName('role').setDescription('Role to inspect')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command must be used in a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const roleOption = interaction.options.getRole('role') as Role | null;
    let targetRole: Role;

    if (roleOption) {
      targetRole = roleOption;
    } else {
      targetRole = interaction.guild.roles.everyone;
    }

    const payload = await this.buildV2(targetRole);
    await interaction.reply(payload as unknown as Parameters<typeof interaction.reply>[0]);
  }

  public override async messageRun(message: Message, args: Args) {
    if (!message.guild) return;
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    let role: Role | null = null;

    const rolePeek = await args.peekResult('role');
    if (rolePeek.isOk()) {
      role = await args.pick('role');
      await args.rest('string').catch(() => null);
    } else if (message.mentions.roles.first()) {
      role = message.mentions.roles.first()!;
      await args.rest('string').catch(() => null);
    } else if (!args.finished) {
      const remainder = await args.rest('string').catch(() => '');
      if (remainder?.trim()) {
        const result = await this.findRole(message.guild, remainder.trim());
        role = result.role;
      }
    } else {
      await args.rest('string').catch(() => null);
    }

    if (!role) {
      role = message.guild.roles.everyone;
    }

    const payload = await this.buildV2(role);
    await channel.send(payload as unknown as Parameters<typeof channel.send>[0]);
  }

  private async buildV2(role: Role) {
    const guild = role.guild;
    const memberCount = role.members.size;
    const createdTs = Math.floor(role.createdTimestamp / 1000);

    const fields = [
      { name: 'Members', value: memberCount.toLocaleString(), icon: 'member' as const },
      { name: 'Position', value: `${role.position}/${guild.roles.cache.size}`, icon: 'role' as const },
      { name: 'Color', value: role.hexColor || 'Default', icon: 'settings' as const }
    ];

    const attributes = [
      `Hoisted: ${role.hoist ? 'Yes' : 'No'}`,
      `Mentionable: ${role.mentionable ? 'Yes' : 'No'}`,
      `Managed: ${role.managed ? 'Yes' : 'No'}`
    ].join('  •  ');

    const permArray = role.permissions.toArray();
    const permNames: Record<string, string> = {
      Administrator: 'Administrator',
      ManageGuild: 'Manage Server',
      ManageRoles: 'Manage Roles',
      ManageChannels: 'Manage Channels',
      ManageWebhooks: 'Manage Webhooks',
      ManageEmojisAndStickers: 'Manage Emojis',
      KickMembers: 'Kick',
      BanMembers: 'Ban',
      ModerateMembers: 'Timeout',
      ViewAuditLog: 'Audit Log',
      SendMessages: 'Send Msgs',
      ManageMessages: 'Manage Msgs',
      EmbedLinks: 'Embed',
      AttachFiles: 'Files',
      ReadMessageHistory: 'History',
      UseExternalEmojis: 'Ext Emojis',
      AddReactions: 'Reactions',
      UseApplicationCommands: 'Slash',
      Connect: 'Connect',
      Speak: 'Speak',
      Stream: 'Video',
      MuteMembers: 'Mute',
      DeafenMembers: 'Deafen',
      MoveMembers: 'Move'
    };

    const blocks: string[] = [`**Attributes:** ${attributes}`, `**Created:** <t:${createdTs}:f> (<t:${createdTs}:R>)`];

    if (permArray.length) {
      const formatted = permArray.map((p) => `\`${permNames[p] || p}\``).join(' ');
      // Truncate if huge
      const trimmed = formatted.length > 800 ? `${formatted.slice(0, 797)}…` : formatted;
      blocks.push(`**Perms [${permArray.length}]:** ${trimmed}`);
    } else {
      blocks.push(`**Perms:** — none`);
    }

    const iconUrl = role.iconURL({ size: 128 });
    const accentColor = role.color || undefined;

    return v2({
      title: role.name,
      subtitle: `ID ${role.id} • ${role.toString()} • Created <t:${createdTs}:R>`,
      accent: 'info',
      accentColor,
      thumbnailUrl: iconUrl,
      thumbnailAlt: role.name,
      fields,
      blocks,
      footer: `Role ID: ${role.id}`
    });
  }

  private async findRole(guild: Guild, query: string): Promise<{ role: Role | null; score: number }> {
    if (!query) {
      return { role: null, score: Number.POSITIVE_INFINITY };
    }
    const trimmed = query.trim();
    if (/^\d{5,}$/.test(trimmed)) {
      const role = guild.roles.cache.get(trimmed) ?? (await guild.roles.fetch(trimmed).catch(() => null));
      if (role) {
        return { role, score: 0 };
      }
    }

    const roles = Array.from(guild.roles.cache.values());
    const fuse = new Fuse(roles, {
      keys: ['name'],
      threshold: 0.4,
      ignoreLocation: true
    });
    const match = fuse.search(trimmed)[0];
    if (match) {
      return { role: match.item, score: match.score ?? 0 };
    }

    return { role: null, score: Number.POSITIVE_INFINITY };
  }
}
