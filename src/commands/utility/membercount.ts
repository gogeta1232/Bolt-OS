import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, Guild, Message } from 'discord.js';

import { v2 } from '../../lib/embeds.js';
import { fetchGuildMemberStats, type GuildMemberStats } from '../../lib/guild-member-stats.js';

@ApplyOptions<Command.Options>({
  name: 'membercount',
  aliases: ['members', 'mc'],
  description: 'Show server member statistics.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class MemberCountCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description), {
      behaviorWhenNotIdentical: RegisterBehavior.Overwrite
    });
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Use this inside a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const guild = interaction.guild;

      await interaction.reply({
        content: 'Loading member statistics...',
        flags: MessageFlags.Ephemeral
      });

      const stats = await fetchGuildMemberStats(guild);

      // Send the final container
      await interaction.editReply({
        content: '',
        ...(this.buildV2(stats, guild) as unknown as Record<string, unknown>)
      });
    } catch (error) {
      this.container.logger.error(
        { err: error, guildId: interaction.guild?.id },
        'Error in membercount command (chatInput)'
      );
      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({
            content: 'An error occurred while fetching member statistics. Please try again.',
            components: [],
            embeds: []
          })
          .catch(() => null);
        return;
      }
      await interaction
        .reply({
          content: 'An error occurred while fetching member statistics. Please try again.',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => null);
    }
  }

  public override async messageRun(message: Message) {
    const guild = message.guild;
    if (!guild) return;
    const channel = message.channel;
    if (!('send' in channel)) return;

    try {
      const loadingMessage = await channel.send('Loading member statistics...');
      const stats = await fetchGuildMemberStats(guild);

      // Send the final container and delete loading message
      await Promise.all([
        channel.send(this.buildV2(stats, guild) as unknown as Parameters<typeof channel.send>[0]),
        loadingMessage.delete()
      ]);
    } catch (error) {
      this.container.logger.error({ err: error, guildId: guild.id }, 'Error in membercount command (message)');
      await channel.send({
        content: 'An error occurred while fetching member statistics. Please try again.'
      });
    }
  }

  private buildV2(stats: GuildMemberStats, guild: Guild) {
    const { total, humans, bots } = stats;

    const thumbnailUrl = guild.iconURL({ size: 128 });
    const subtitle = `${total.toLocaleString()} members • ${humans.toLocaleString()} humans • ${bots.toLocaleString()} bots`;

    const fields = [
      { name: 'Total', value: total.toLocaleString(), icon: 'member' as const },
      { name: 'Humans', value: humans.toLocaleString(), icon: 'humans' as const },
      { name: 'Bots', value: bots.toLocaleString(), icon: 'bots' as const }
    ];

    return v2({
      title: 'Member Statistics',
      subtitle,
      accent: 'info',
      thumbnailUrl,
      fields,
      footer: guild.name
    });
  }
}
