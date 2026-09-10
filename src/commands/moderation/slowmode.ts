import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  ChannelType,
  type ChatInputCommandInteraction,
  Message,
  NewsChannel,
  PermissionFlagsBits,
  TextChannel,
  type TextBasedChannel
} from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { replyToast } from '../../lib/respond.js';

const MAX_SLOWMODE = 21_600; // 6 hours

@ApplyOptions<Command.Options>({
  name: 'slowmode',
  description: 'Adjust channel slowmode or toggle locks.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['ManageChannels', 'SendMessages'],
  requiredUserPermissions: ['ManageChannels'],
  fullCategory: ['moderation']
})
export class SlowmodeCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
          .addSubcommand((sub) =>
            sub
              .setName('set')
              .setDescription('Set slowmode seconds for a text channel.')
              .addIntegerOption((option) =>
                option
                  .setName('seconds')
                  .setDescription('Slowmode delay in seconds')
                  .setMinValue(0)
                  .setMaxValue(MAX_SLOWMODE)
                  .setRequired(true)
              )
              .addChannelOption((option) =>
                option
                  .setName('channel')
                  .setDescription('Target channel (defaults to current)')
                  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Why are you changing slowmode?'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('lock')
              .setDescription('Lock a channel by removing send message permissions.')
              .addChannelOption((option) =>
                option
                  .setName('channel')
                  .setDescription('Target channel (defaults to current)')
                  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Optional reason to log.'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('unlock')
              .setDescription('Unlock a channel and restore sending permissions.')
              .addChannelOption((option) =>
                option
                  .setName('channel')
                  .setDescription('Target channel (defaults to current)')
                  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Optional reason to log.'))
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand(true);
    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextBasedChannel | null;
    if (!channel || !this.isGuildText(channel)) {
      await replyToast(interaction, 'warning', 'Select a text channel inside the server.');
      return;
    }

    if (!channel.permissionsFor(interaction.guild!.members.me!).has(PermissionFlagsBits.ManageChannels)) {
      await replyToast(interaction, 'warning', 'I need Manage Channels in that channel.');
      return;
    }

    switch (subcommand) {
      case 'set': {
        const seconds = interaction.options.getInteger('seconds', true);
        const reason = interaction.options.getString('reason') ?? 'Slowmode updated';
        await channel.setRateLimitPerUser(seconds, reason);
        await replyToast(
          interaction,
          'success',
          `${getEmoji('settings')} Slowmode ${seconds ? `set to ${seconds}s` : 'disabled'} for ${channel.toString()}.`
        );
        const context = buildModerationContext({
          actor: interaction.user,
          target: null,
          channel,
          reason
        });
        context.metadata = {
          Action: 'Slowmode Set',
          Duration: `${seconds}s`
        };
        await this.container.logging.sendAdministrativeLog(
          interaction.guild!,
          `${getEmoji('settings')} ${interaction.user.toString()} set slowmode to ${seconds}s in ${channel.toString()}`,
          context
        );
        break;
      }
      case 'lock': {
        const reason = interaction.options.getString('reason') ?? 'Channel locked';
        await this.setLock(channel, true, reason);
        await replyToast(interaction, 'warning', `${getEmoji('settings')} ${channel.toString()} locked.`);
        const lockContext = buildModerationContext({
          actor: interaction.user,
          channel,
          reason
        });
        lockContext.metadata = { Action: 'Channel Locked' };
        await this.container.logging.sendAdministrativeLog(
          interaction.guild!,
          `${getEmoji('settings')} ${interaction.user.toString()} locked ${channel.toString()}`,
          lockContext
        );
        break;
      }
      case 'unlock': {
        const reason = interaction.options.getString('reason') ?? 'Channel unlocked';
        await this.setLock(channel, false, reason);
        await replyToast(interaction, 'success', `${getEmoji('settings')} ${channel.toString()} unlocked.`);
        const unlockContext = buildModerationContext({
          actor: interaction.user,
          channel,
          reason
        });
        unlockContext.metadata = { Action: 'Channel Unlocked' };
        await this.container.logging.sendAdministrativeLog(
          interaction.guild!,
          `${getEmoji('settings')} ${interaction.user.toString()} unlocked ${channel.toString()}`,
          unlockContext
        );
        break;
      }
      default:
        break;
    }
  }

  public override async messageRun(message: Message, args: Args) {
    const channel = message.channel;
    if (!this.isGuildText(channel)) return;

    const action = (await args.pick('string').catch(() => null))?.toLowerCase() ?? 'status';

    if (action === 'status') {
      const locked = channel.permissionOverwrites.cache
        .get(channel.guild.roles.everyone.id)
        ?.deny.has(PermissionFlagsBits.SendMessages);
      await replyToast(
        message,
        'info',
        `${getEmoji('settings')} Slowmode currently ${channel.rateLimitPerUser ? `${channel.rateLimitPerUser}s` : 'disabled'}${locked ? '\nChannel is locked.' : ''}`
      );
      return;
    }

    const seconds = action === 'set' ? await args.pick('integer').catch(() => null) : null;
    const reason = await args.rest('string').catch(() => null);

    if (action === 'set') {
      if (seconds === null || Number.isNaN(seconds)) {
        await replyToast(message, 'warning', 'Provide slowmode seconds (0-21600).');
        return;
      }
      const bounded = Math.min(Math.max(seconds, 0), MAX_SLOWMODE);
      await channel.setRateLimitPerUser(bounded, reason ?? 'Slowmode updated');
      await replyToast(message, 'success', `Slowmode ${bounded ? `set to ${bounded}s` : 'disabled'}.`);
      return;
    }

    if (action === 'lock') {
      await this.setLock(channel, true, reason ?? 'Channel locked');
      await replyToast(message, 'warning', 'Channel locked.');
      return;
    }

    if (action === 'unlock') {
      await this.setLock(channel, false, reason ?? 'Channel unlocked');
      await replyToast(message, 'success', 'Channel unlocked.');
    }
  }

  private async setLock(channel: TextChannel | NewsChannel, locked: boolean, reason: string) {
    const overwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
    if (locked) {
      await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone,
        { SendMessages: false, AddReactions: false },
        { reason }
      );
      return;
    }

    const newPerms: { SendMessages?: null; AddReactions?: null } = {};
    if (overwrite?.deny.has(PermissionFlagsBits.SendMessages)) {
      newPerms.SendMessages = null;
    }
    if (overwrite?.deny.has(PermissionFlagsBits.AddReactions)) {
      newPerms.AddReactions = null;
    }
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, newPerms, { reason });
  }

  private isGuildText(channel: TextBasedChannel | null): channel is TextChannel | NewsChannel {
    return Boolean(
      channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    );
  }
}
