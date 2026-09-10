import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildChannel, GuildMember, TextChannel } from 'discord.js';
import { Message, PermissionFlagsBits, Role } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { ChannelSnapshotModel } from '../../database/models/guild/ChannelSnapshot.js';

@ApplyOptions<Command.Options>({
  name: 'hide',
  description: 'Hide a channel from users/roles.',
  requiredClientPermissions: ['ManageChannels', 'ManageRoles'],
  requiredUserPermissions: ['ManageChannels'],
  runIn: ['GUILD_ANY']
})
export class HideCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
          .addUserOption((option) => option.setName('user').setDescription('User to hide from').setRequired(false))
          .addRoleOption((option) => option.setName('role').setDescription('Role to hide from').setRequired(false)),
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

        if (permissionOverwrite?.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is already hidden from ${user.user.tag}.`;
          await this.reply(source, description, 'info');
          return;
        }

        const existingSnapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'user',
          targetId: user.id
        });

        if (!existingSnapshot) {
          await ChannelSnapshotModel.create({
            channelId: channel.id,
            guildId: channel.guild.id,
            targetType: 'user',
            targetId: user.id,
            permissionState: {
              allow: permissionOverwrite?.allow.toArray().join(',') || '',
              deny: permissionOverwrite?.deny.toArray().join(',') || ''
            },
            createdBy: actorTag
          });
        }

        await channel.permissionOverwrites.edit(user, { ViewChannel: false }, { reason: `hide by ${actorTag}` });
        targetDescription = `${getEmoji('channel')} | ${channelName} hidden from ${user.user.tag}`;
      } else if (role) {
        const permissionOverwrite = channel.permissionOverwrites.cache.get(role.id);

        if (permissionOverwrite?.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is already hidden from ${role.name}.`;
          await this.reply(source, description, 'info');
          return;
        }

        const existingSnapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'role',
          targetId: role.id
        });

        if (!existingSnapshot) {
          await ChannelSnapshotModel.create({
            channelId: channel.id,
            guildId: channel.guild.id,
            targetType: 'role',
            targetId: role.id,
            permissionState: {
              allow: permissionOverwrite?.allow.toArray().join(',') || '',
              deny: permissionOverwrite?.deny.toArray().join(',') || ''
            },
            createdBy: actorTag
          });
        }

        await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: `hide by ${actorTag}` });
        targetDescription = `${getEmoji('channel')} | ${channelName} hidden from ${role.name}`;
      } else {
        const everyoneRole =
          channel.guild.roles.cache.find((r) => r.name === '@everyone') || channel.guild.roles.everyone;
        const permissionOverwrite = channel.permissionOverwrites.cache.get(everyoneRole.id);

        if (permissionOverwrite?.deny.has('ViewChannel')) {
          const description = `${getEmoji('channel')} ${channelName} is already hidden from @everyone.`;
          await this.reply(source, description, 'info');
          return;
        }

        const existingSnapshot = await ChannelSnapshotModel.findOne({
          channelId: channel.id,
          targetType: 'everyone',
          targetId: everyoneRole.id
        });

        if (!existingSnapshot) {
          await ChannelSnapshotModel.create({
            channelId: channel.id,
            guildId: channel.guild.id,
            targetType: 'everyone',
            targetId: everyoneRole.id,
            permissionState: {
              allow: permissionOverwrite?.allow.toArray().join(',') || '',
              deny: permissionOverwrite?.deny.toArray().join(',') || ''
            },
            createdBy: actorTag
          });
        }

        const allOverwrites = channel.permissionOverwrites.cache;
        const snapshotPromises = [];

        for (const [id, overwrite] of allOverwrites) {
          if (id === everyoneRole.id) continue;

          const isRole = channel.guild.roles.cache.has(id);
          const targetType = isRole ? 'role' : 'user';

          snapshotPromises.push(
            ChannelSnapshotModel.findOne({
              channelId: channel.id,
              targetType,
              targetId: id
            })
              .then((existingSnapshot) => {
                if (!existingSnapshot) {
                  return ChannelSnapshotModel.create({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    targetType,
                    targetId: id,
                    permissionState: {
                      allow: overwrite.allow.toArray().join(','),
                      deny: overwrite.deny.toArray().join(',')
                    },
                    createdBy: actorTag
                  });
                }
                return null;
              })
              .catch((error) => {
                this.container.logger.warn({ err: error }, `Failed to save snapshot for ${targetType} ${id}`);
              })
          );
        }

        await Promise.all(snapshotPromises);

        await channel.permissionOverwrites.edit(
          everyoneRole,
          { ViewChannel: false },
          { reason: `hide by ${actorTag}` }
        );
        targetDescription = `${getEmoji('channel')} | ${channelName} hidden from @everyone`;
      }

      await this.reply(source, targetDescription, 'info');
    } catch (error) {
      this.container.logger.error({ err: error }, 'Channel hide failed');
      await this.reply(source, `${getEmoji('danger')} | Failed to hide channel.`, 'danger');
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
