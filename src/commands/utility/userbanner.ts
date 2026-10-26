import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, type GuildMember, Message, type User, MessageFlags } from 'discord.js';

import { single, v2 } from '../../lib/embeds.js';
import { fetchUserProfile } from '../../lib/user-profile.js';

@ApplyOptions<Command.Options>({
  name: 'userbanner',
  aliases: ['ubanner', 'profilebanner', 'banner'],
  description: 'Display a user banner in crisp resolution.',
  runIn: ['GUILD_ANY', 'DM'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class UserBannerCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Whose banner do you want to view?')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('target') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(target.id) ?? null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await this.buildV2(target, member);
    await interaction.editReply(payload);
  }

  public override async messageRun(message: Message, args: Args) {
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    let target: User | null = null;
    let member: GuildMember | null = null;

    // Sapphire Args: memberResolved / user preferred, fallback to resolver + mentions
    const memberResult = await args.pickResult('memberResolved');
    if (memberResult.isOk()) {
      const resolved = memberResult.unwrap();
      member = resolved;
      target = resolved.user;
      await args.rest('string').catch(() => null);
    } else {
      const userResult = await args.pickResult('user');
      if (userResult.isOk()) {
        const resolvedUser = userResult.unwrap();
        target = resolvedUser;
        member = message.guild
          ? (message.guild.members.cache.get(resolvedUser.id) ??
            (await message.guild.members.fetch(resolvedUser.id).catch(() => null)))
          : null;
        await args.rest('string').catch(() => null);
      } else {
        const remainder = await args.rest('string').catch(() => '');
        const tokens = remainder?.trim() ? remainder.trim().split(/\s+/).filter(Boolean) : [];
        if (message.guild && tokens.length) {
          const resolution = await this.container.memberResolver.resolve(message, tokens);
          if (resolution.member) {
            member = resolution.member;
            target = resolution.member.user;
          } else if (resolution.reason === 'ambiguous' && resolution.feedback) {
            await channel.send(single(resolution.feedback, 'warning') as unknown as Parameters<typeof channel.send>[0]);
            return;
          }
        }
        if (!target) {
          target = message.mentions.users.first() ?? null;
          member = target && message.guild ? await message.guild.members.fetch(target.id).catch(() => null) : member;
        }
      }
    }

    if (!target) {
      target = message.author;
      member = message.member ?? null;
    }

    const payload = await this.buildV2(
      target,
      member ?? (message.guild ? (message.guild.members.cache.get(target.id) ?? null) : null)
    );
    await channel.send(payload as unknown as Parameters<typeof channel.send>[0]);
  }

  private async buildV2(user: User, member: GuildMember | null) {
    const fetchedUser = await fetchUserProfile(user);
    const bannerURL = fetchedUser?.bannerURL({ size: 4096 }) ?? null;

    if (!fetchedUser || !bannerURL) {
      return single(`${user.tag} doesn't have a banner set.`, 'warning');
    }

    const formats: Array<'png' | 'jpg' | 'webp' | 'gif'> = ['png', 'jpg', 'webp'];
    if (fetchedUser?.banner && fetchedUser.banner.startsWith('a_')) formats.unshift('gif');
    const links = formats
      .map((fmt) => `[${fmt.toUpperCase()}](${fetchedUser.bannerURL({ extension: fmt, size: 4096 })})`)
      .join('  •  ');

    const accentColor = member?.displayColor && member.displayColor !== 0 ? member.displayColor : undefined;

    return v2({
      title: `${user.tag} • Banner`,
      subtitle: `ID ${user.id}`,
      accent: 'primary',
      accentColor,
      thumbnailUrl: user.displayAvatarURL({ size: 128 }),
      thumbnailAlt: user.tag,
      blocks: [links],
      bannerUrl: bannerURL,
      footer: user.tag
    });
  }
}
