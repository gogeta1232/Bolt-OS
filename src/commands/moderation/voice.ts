import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, GuildMember, Message, PermissionFlagsBits } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { replyToast } from '../../lib/respond.js';

type VoiceAction = 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect';

@ApplyOptions<Command.Options>({
  name: 'voice',
  description: 'Moderate members in voice channels.',
  requiredClientPermissions: ['MuteMembers', 'DeafenMembers', 'MoveMembers'],
  requiredUserPermissions: ['MuteMembers', 'DeafenMembers', 'MoveMembers'],
  fullCategory: ['moderation'],
  runIn: ['GUILD_ANY']
})
export class VoiceCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(
            PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers | PermissionFlagsBits.MoveMembers
          )
          .addSubcommand((sub) =>
            sub
              .setName('mute')
              .setDescription('Mute a member in voice.')
              .addUserOption((option) => option.setName('target').setDescription('Member to mute').setRequired(true))
              .addStringOption((option) => option.setName('reason').setDescription('Reason'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('unmute')
              .setDescription('Unmute a member in voice.')
              .addUserOption((option) => option.setName('target').setDescription('Member to unmute').setRequired(true))
              .addStringOption((option) => option.setName('reason').setDescription('Reason'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('deafen')
              .setDescription('Deafen a member in voice.')
              .addUserOption((option) => option.setName('target').setDescription('Member to deafen').setRequired(true))
              .addStringOption((option) => option.setName('reason').setDescription('Reason'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('undeafen')
              .setDescription('Undeafen a member in voice.')
              .addUserOption((option) =>
                option.setName('target').setDescription('Member to undeafen').setRequired(true)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Reason'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('disconnect')
              .setDescription('Disconnect a member from voice.')
              .addUserOption((option) =>
                option.setName('target').setDescription('Member to disconnect').setRequired(true)
              )
              .addStringOption((option) => option.setName('reason').setDescription('Reason'))
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const action = interaction.options.getSubcommand(true) as VoiceAction;
    const target = interaction.options.getMember('target');
    if (!(target instanceof GuildMember)) {
      await replyToast(interaction, 'warning', 'Cannot find that member.');
      return;
    }
    const reason = interaction.options.getString('reason') ?? `${action} executed by ${interaction.user.tag}`;
    await this.apply(interaction, target, action, reason);
  }

  public override async messageRun(message: Message, args: Args) {
    void args;
    if (!message.inGuild()) return;

    const tokens = message.content.trim().split(/\s+/).slice(1);
    const actionToken = tokens.shift()?.toLowerCase() as VoiceAction | undefined;
    if (!actionToken || !['mute', 'unmute', 'deafen', 'undeafen', 'disconnect'].includes(actionToken)) {
      await replyToast(message, 'warning', 'Usage: `!voice <mute|unmute|deafen|undeafen|disconnect> @member [reason]`');
      return;
    }

    if (!tokens.length) {
      await replyToast(message, 'warning', 'Provide the member to target.');
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const member = resolution.member;
    if (!member) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Mention the target member.');
      return;
    }

    const reason =
      tokens.slice(resolution.consumed).join(' ').trim() || `${actionToken} executed by ${message.author.tag}`;
    await this.apply(message, member, actionToken, reason);
  }

  private async apply(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    action: VoiceAction,
    reason: string
  ) {
    if (!member.voice.channel) {
      await replyToast(source, 'warning', `${member.user.tag} is not in a voice channel.`);
      return;
    }

    if (!member.manageable) {
      await replyToast(source, 'warning', `Cannot act on ${member.user.tag}.`);
      return;
    }

    try {
      switch (action) {
        case 'mute':
          await member.voice.setMute(true, reason);
          await replyToast(source, 'success', `${getEmoji('mute')} ${member.user.tag} muted.`);
          break;
        case 'unmute':
          await member.voice.setMute(false, reason);
          await replyToast(source, 'success', `${getEmoji('mute')} ${member.user.tag} unmuted.`);
          break;
        case 'deafen':
          await member.voice.setDeaf(true, reason);
          await replyToast(source, 'success', `${getEmoji('mute')} ${member.user.tag} deafened.`);
          break;
        case 'undeafen':
          await member.voice.setDeaf(false, reason);
          await replyToast(source, 'success', `${getEmoji('mute')} ${member.user.tag} undeafened.`);
          break;
        case 'disconnect':
          await member.voice.disconnect(reason);
          await replyToast(source, 'success', `${getEmoji('mute')} ${member.user.tag} disconnected from voice.`);
          break;
        default:
          break;
      }

      const moderationContext = buildModerationContext({
        actor: source instanceof Message ? source.author : source.user,
        target: member,
        reason
      });
      moderationContext.metadata = {
        Action: action
      };

      void (async () => {
        try {
          await this.container.logging.sendAdministrativeLog(
            member.guild,
            `${getEmoji('mute')} ${source instanceof Message ? source.author.toString() : source.user.toString()} used ${action} on ${member.user.toString()}`,
            moderationContext
          );
        } catch (error) {
          this.container.logger.error(
            { err: error, guildId: member.guild.id },
            'Failed to dispatch voice moderation log'
          );
        }
      })();
    } catch (error) {
      this.container.logger.error({ err: error }, 'Voice moderation failed');
      await replyToast(source, 'danger', 'Voice moderation failed.');
    }
  }
}
