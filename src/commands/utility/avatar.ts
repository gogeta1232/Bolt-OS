import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  Message,
  type User
} from 'discord.js';

import { theme } from '../../config/theme.js';

const AVATAR_DISPLAY_SIZE = 4096;
const TOKEN_SPLIT_PATTERN = /\s+/;

@ApplyOptions<Command.Options>({
  name: 'avatar',
  aliases: ['pfp', 'icon', 'av'],
  description: 'Display a user avatar in crisp resolution.',
  runIn: ['GUILD_ANY', 'DM'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class AvatarCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Whose avatar do you want to view?')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('target') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(target.id) ?? null;
    const embed = this.buildEmbed(target, member);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  public override async messageRun(message: Message, args: Args) {
    const remainder = await args.rest('string').catch(() => '');
    const tokens = remainder.trim() ? remainder.trim().split(TOKEN_SPLIT_PATTERN).filter(Boolean) : [];
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    let target: User | null = null;
    let member: GuildMember | null = null;

    if (message.guild && tokens.length) {
      const resolution = await this.container.memberResolver.resolve(message, tokens);
      if (resolution.member) {
        member = resolution.member;
        target = resolution.member.user;
      } else if (resolution.reason === 'ambiguous' && resolution.feedback) {
        await channel.send({ embeds: [this.buildNoticeEmbed(resolution.feedback)] });
        return;
      }
    }

    if (!target) {
      target = message.mentions.users.first() ?? null;
      member = target && message.guild ? await message.guild.members.fetch(target.id).catch(() => null) : member;
    }

    if (!target) {
      target = message.author;
      member = message.member ?? null;
    }

    const embed = this.buildEmbed(
      target,
      member ?? (message.guild ? (message.guild.members.cache.get(target.id) ?? null) : null)
    );
    await channel.send({ embeds: [embed] });
  }

  private buildNoticeEmbed(description: string) {
    return new EmbedBuilder().setColor(theme.colors.warning).setDescription(description).setTimestamp();
  }

  private buildEmbed(user: User, member: GuildMember | null) {
    const display = user.displayAvatarURL({ extension: 'png', size: AVATAR_DISPLAY_SIZE });
    const formats: Array<'png' | 'jpg' | 'webp' | 'gif'> = ['png', 'jpg', 'webp'];
    if (user.avatar && user.avatar.startsWith('a_')) formats.unshift('gif');
    const links = formats
      .map((fmt) => `[${fmt.toUpperCase()}](${user.displayAvatarURL({ extension: fmt, size: AVATAR_DISPLAY_SIZE })})`)
      .join(' • ');

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor && member.displayColor !== 0 ? member.displayColor : theme.colors.info)
      .setAuthor({ name: user.tag, iconURL: display })
      .setImage(display)
      .setDescription(links)
      .setFooter({ text: `ID: ${user.id}` });

    return embed;
  }
}
