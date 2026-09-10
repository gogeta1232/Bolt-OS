import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, GuildMember, Message, PermissionFlagsBits } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

@ApplyOptions<Command.Options>({
  name: 'nick',
  aliases: ['nickname'],
  description: 'Change or reset a member nickname.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['ManageNicknames'],
  fullCategory: ['moderation']
})
export class NickCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
          .addUserOption((option) => option.setName('target').setDescription('Member to rename').setRequired(true))
          .addStringOption((option) =>
            option.setName('nickname').setDescription('New nickname (leave empty to reset)')
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        embeds: [
          createEmbed({
            description: 'This command can only be used in a server.',
            type: 'warning'
          })
        ],
        ephemeral: true
      });
      return;
    }

    // Native Discord perms (ManageNicknames/Admin) or owner or adminRole.
    const allowed = await hasModerationPermission(
      guild,
      interaction.member as GuildMember,
      interaction.user.id,
      'nick'
    );

    if (!allowed) {
      await interaction.reply({
        embeds: [
          createEmbed({
            description: 'You do not have permission to use this command.',
            type: 'warning'
          })
        ],
        ephemeral: true
      });
      return;
    }

    const target = interaction.options.getMember('target');
    if (!(target instanceof GuildMember)) {
      await interaction.reply({
        embeds: [
          createEmbed({
            description: 'Cannot find that member.',
            type: 'warning'
          })
        ],
        ephemeral: true
      });
      return;
    }
    const nickname = interaction.options.getString('nickname');
    await this.applyNickname(interaction, target, nickname);
  }

  public override async messageRun(message: Message, args: Args) {
    void args;
    if (!message.inGuild()) return;

    const guild = message.guild!;
    const member = message.member;
    if (!member) return;

    // Native Discord perms (ManageNicknames/Admin) or owner or adminRole.
    const allowed = await hasModerationPermission(guild, member, member.id, 'nick');

    if (!allowed) {
      await message.reply({
        embeds: [
          createEmbed({
            description: 'You do not have permission to use this command.',
            type: 'warning'
          })
        ],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await message.reply({
        embeds: [
          createEmbed({
            description: 'Usage: `!nick <member> [nickname]`',
            type: 'info'
          })
        ],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const targetMember = resolution.member;
    if (!targetMember) {
      await message.reply({
        embeds: [
          createEmbed({
            description: resolution.feedback ?? 'Could not find that member.',
            type: 'warning'
          })
        ],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    const nicknameTokens = tokens.slice(resolution.consumed);
    const nickname = nicknameTokens.length ? nicknameTokens.join(' ').trim() || null : null;
    await this.applyNickname(message, targetMember, nickname);
  }

  private async applyNickname(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    nickname: string | null
  ) {
    const actor = source instanceof Message ? source.author : source.user;
    if (!member.manageable) {
      const response = createEmbed({
        description: `Cannot change nickname for ${member.user.tag}.`,
        type: 'warning'
      });
      if (source instanceof Message) {
        await source.reply({
          embeds: [response],
          allowedMentions: { repliedUser: false }
        });
      } else {
        await source.reply({ embeds: [response], ephemeral: true });
      }
      return;
    }

    try {
      await member.setNickname(nickname, `Nickname updated by ${actor.tag}`);
      const description = nickname
        ? `${getEmoji('settings')} ${member.user.tag} nick set to **${nickname}**.`
        : `${getEmoji('settings')} ${member.user.tag} nickname reset.`;
      const embed = createEmbed({ description, type: 'success' });

      if (source instanceof Message) {
        await source.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });
      } else {
        await source.reply({ embeds: [embed], ephemeral: true });
      }

      // Fire-and-forget logging for better performance
      const moderationContext = buildModerationContext({
        actor,
        target: member,
        reason: nickname ? `Nickname set to ${nickname}` : 'Nickname reset'
      });
      moderationContext.metadata = {
        'Previous Nickname': member.nickname ?? 'None',
        'New Nickname': nickname ?? 'Cleared'
      };

      this.container.logging
        .sendAdministrativeLog(
          member.guild,
          `${getEmoji('settings')} ${actor.tag} ${nickname ? `set nickname` : 'reset nickname'} for ${member.user.toString()}`,
          moderationContext
        )
        .catch((error) => {
          this.container.logger.error({ err: error, guildId: member.guild.id }, 'Failed to dispatch nickname log');
        });
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to set nickname');
      const embed = createEmbed({
        description: 'Failed to update nickname.',
        type: 'danger'
      });
      if (source instanceof Message) {
        await source.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });
      } else {
        await source.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}
