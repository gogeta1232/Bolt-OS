import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, type Guild, Message, MessageFlags } from 'discord.js';

import { single, v2 } from '../../lib/embeds.js';

@ApplyOptions<Command.Options>({
  name: 'serverbanner',
  aliases: ['sbanner', 'guildbanner'],
  description: 'Display the server banner in crisp resolution.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class ServerBannerCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description), {
      behaviorWhenNotIdentical: RegisterBehavior.Overwrite
    });
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Run this inside a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const payload = await this.buildV2(interaction.guild);
    if (typeof payload === 'object' && payload !== null && 'flags' in payload) {
      await interaction.reply(payload as unknown as Parameters<typeof interaction.reply>[0]);
    } else {
      await interaction.reply(payload as unknown as Parameters<typeof interaction.reply>[0]);
    }
  }

  public override async messageRun(message: Message) {
    if (!message.guild) return;
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const payload = await this.buildV2(message.guild);
    await channel.send(payload as unknown as Parameters<typeof channel.send>[0]);
  }

  private async buildV2(guild: Guild) {
    const bannerURL = guild.bannerURL({ size: 4096 });

    if (!bannerURL) {
      return single("This server doesn't have a banner set.", 'warning') as unknown as ReturnType<typeof v2>;
    }

    const formats: Array<'png' | 'jpg' | 'webp' | 'gif'> = ['png', 'jpg', 'webp'];
    if (guild.banner && guild.banner.startsWith('a_')) formats.unshift('gif');
    const links = formats
      .map((fmt) => `[${fmt.toUpperCase()}](${guild.bannerURL({ extension: fmt, size: 4096 })})`)
      .join('  •  ');

    return v2({
      title: `${guild.name} Banner`,
      subtitle: `ID ${guild.id} • ${guild.memberCount.toLocaleString()} members`,
      accent: 'info',
      thumbnailUrl: guild.iconURL({ size: 128 }),
      thumbnailAlt: guild.name,
      blocks: [links],
      bannerUrl: bannerURL,
      footer: guild.name
    });
  }
}
