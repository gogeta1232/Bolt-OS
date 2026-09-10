import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildChannel, GuildMember, TextChannel } from 'discord.js';
import { Message, PermissionFlagsBits, Role } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { ChannelSnapshotModel } from '../../database/models/guild/ChannelSnapshot.js';

@ApplyOptions<Command.Options>({
  name: 'unhide',
  description: 'Unhide a channel for users/roles.',
  requiredClientPermissions: ['ManageChannels', 'ManageRoles'],
  requiredUserPermissions: ['ManageChannels'],
  runIn: ['GUILD_ANY']
})
export class UnhideCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
          .addUserOption((option) => option.setName('user').setDescription('User to unhide for').setRequired(false))
          .addRoleOption((option) => option.setName('role').setDescription('Role to unhide for').setRequired(false)),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel as GuildChannel | null;
    if (!channel || !('permissionOverwrites' in channel)) {
      await interaction.reply({
        embeds: [createEmbed({ description: 'This command must be used in a channel.', type: 'warning' })],
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getMember('user') as GuildMember | null;
    const role = interaction.options.getRole('role') as Role | null;

    await this.applyAction(interaction, channel, user, role);
  }

  public override async messageRun(message: Message) {
    const channel = message.channel as GuildChannel | null;
    if (!channel || !('permissionOverwrites' in channel)) return;

    const user = message.mentions.members?.first() ?? null;
    const role = message.mentions.roles.first() ?? null;

    await this.applyAction(message, channel, user, role);
  }

  private async applyAction(
    source: ChatInputCommandInteraction | Message,
    channel: GuildChannel,
    user: GuildMember | null,
    role: Role | null
  ) {
    if (!('permissionOverwrites' in channel)) return;

    const channelName = (channel as TextChannel).name || channel.id;
    const actorTag = source instanceof Message ? source.author.tag : source.user.tag;
    let targetDescription = '';

    try {
      if (user) {
        const permissionOverwrite = channel.permissionOverwrites.cache.get(user.id);
        if (!permissionOverwrite || !permissionOverwrite.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is not hidden from ${user.user.tag}.`;
          await this.reply(source, description, 'info');
          return;
        }

        const snapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'user',
          targetId: user.id
        });

        if (snapshot) {
          const allowPermissions = snapshot.permissionState.allow
            ? snapshot.permissionState.allow.split(',').filter((p) => p)
            : [];
          const denyPermissions = snapshot.permissionState.deny
            ? snapshot.permissionState.deny.split(',').filter((p) => p)
            : [];

          const updatedDenyPermissions = denyPermissions.filter((p) => p !== 'ViewChannel');

          await channel.permissionOverwrites.edit(
            user,
            {
              ViewChannel: null,
              ...(allowPermissions.length > 0 ? { Allow: allowPermissions } : {}),
              ...(updatedDenyPermissions.length > 0 ? { Deny: updatedDenyPermissions } : {})
            },
            { reason: `unhide by ${actorTag}` }
          );

          await ChannelSnapshotModel.deleteOne({ _id: snapshot._id });
        } else {
          await channel.permissionOverwrites.edit(user, { ViewChannel: null }, { reason: `unhide by ${actorTag}` });
        }

        targetDescription = `${getEmoji('channel')} | ${channelName} unhidden for ${user.user.tag}`;
      } else if (role) {
        const permissionOverwrite = channel.permissionOverwrites.cache.get(role.id);
        if (!permissionOverwrite || !permissionOverwrite.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is not hidden from ${role.name}.`;
          await this.reply(source, description, 'info');
          return;
        }

        const snapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'role',
          targetId: role.id
        });

        if (snapshot) {
          const allowPermissions = snapshot.permissionState.allow
            ? snapshot.permissionState.allow.split(',').filter((p) => p)
            : [];
          const denyPermissions = snapshot.permissionState.deny
            ? snapshot.permissionState.deny.split(',').filter((p) => p)
            : [];

          const updatedDenyPermissions = denyPermissions.filter((p) => p !== 'ViewChannel');

          await channel.permissionOverwrites.edit(
            role,
            {
              ViewChannel: null,
              ...(allowPermissions.length > 0 ? { Allow: allowPermissions } : {}),
              ...(updatedDenyPermissions.length > 0 ? { Deny: updatedDenyPermissions } : {})
            },
            { reason: `unhide by ${actorTag}` }
          );

          await ChannelSnapshotModel.deleteOne({ _id: snapshot._id });
        } else {
          await channel.permissionOverwrites.edit(role, { ViewChannel: null }, { reason: `unhide by ${actorTag}` });
        }

        targetDescription = `${getEmoji('channel')} | ${channelName} unhidden for ${role.name}`;
      } else {
        const everyoneRole =
          channel.guild.roles.cache.find((r) => r.name === '@everyone') || channel.guild.roles.everyone;
        const permissionOverwrite = channel.permissionOverwrites.cache.get(everyoneRole.id);

        if (!permissionOverwrite || !permissionOverwrite.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is not hidden from @everyone.`;
          await this.reply(source, description, 'info');
          return;
        }

        const everyoneSnapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'everyone',
          targetId: everyoneRole.id
        });

        if (everyoneSnapshot) {
          const allowPermissions = everyoneSnapshot.permissionState.allow
            ? everyoneSnapshot.permissionState.allow.split(',').filter((p) => p)
            : [];
          const denyPermissions = everyoneSnapshot.permissionState.deny
            ? everyoneSnapshot.permissionState.deny.split(',').filter((p) => p)
            : [];

          const updatedDenyPermissions = denyPermissions.filter((p) => p !== 'ViewChannel');

          await channel.permissionOverwrites.edit(
            everyoneRole,
            {
              ViewChannel: null,
              ...(allowPermissions.length > 0 ? { Allow: allowPermissions } : {}),
              ...(updatedDenyPermissions.length > 0 ? { Deny: updatedDenyPermissions } : {})
            },
            { reason: `unhide by ${actorTag}` }
          );

          await ChannelSnapshotModel.deleteOne({ _id: everyoneSnapshot._id });
        } else {
          await channel.permissionOverwrites.edit(
            everyoneRole,
            { ViewChannel: null },
            { reason: `unhide by ${actorTag}` }
          );
        }

        const allSnapshots = await ChannelSnapshotModel.find({
          channelId: channel.id,
          targetType: { $in: ['user', 'role'] }
        });

        const restorePromises = allSnapshots.map(async (snapshot) => {
          try {
            const allowPermissions = snapshot.permissionState.allow
              ? snapshot.permissionState.allow.split(',').filter((p: string) => p)
              : [];
            const denyPermissions = snapshot.permissionState.deny
              ? snapshot.permissionState.deny.split(',').filter((p: string) => p)
              : [];

            const updatedDenyPermissions = denyPermissions.filter((p: string) => p !== 'ViewChannel');

            const target: GuildMember | Role | null =
              snapshot.targetType === 'user'
                ? await channel.guild.members.fetch(snapshot.targetId).catch(() => null)
                : await channel.guild.roles.fetch(snapshot.targetId);

            if (target) {
              await channel.permissionOverwrites.edit(
                target,
                {
                  ViewChannel: null,
                  ...(allowPermissions.length > 0 ? { Allow: allowPermissions } : {}),
                  ...(updatedDenyPermissions.length > 0 ? { Deny: updatedDenyPermissions } : {})
                },
                { reason: `unhide by ${actorTag}` }
              );
            }

            await ChannelSnapshotModel.deleteOne({ _id: snapshot._id });
          } catch (error) {
            this.container.logger.warn(
              { err: error },
              `Failed to restore snapshot for ${snapshot.targetType} ${snapshot.targetId}`
            );
          }
        });

        await Promise.all(restorePromises);

        targetDescription = `${getEmoji('channel')} | ${channelName} unhidden for @everyone`;
      }

      await this.reply(source, targetDescription, 'info');
    } catch (error) {
      this.container.logger.error({ err: error }, 'Channel unhide failed');
      await this.reply(source, `${getEmoji('danger')} | Failed to unhide channel.`, 'danger');
    }
  }

  private async reply(
    source: ChatInputCommandInteraction | Message,
    description: string,
    type: 'success' | 'warning' | 'danger' | 'info'
  ) {
    const embed = createEmbed({ description, type, styled: false });
    if (source instanceof Message) {
      await source.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } else {
      const payload = { embeds: [embed], ephemeral: true } as const;
      if (source.deferred || source.replied) {
        await source.followUp(payload);
      } else {
        await source.reply(payload);
      }
    }
  }
}
