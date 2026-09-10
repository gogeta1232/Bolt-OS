import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import { Message, MessageFlags } from 'discord.js';

import { rich, v2 } from '../../lib/embeds.js';

@ApplyOptions<Command.Options>({
  name: 'boostcount',
  description: 'Show the server boost count and tier.',
  requiredClientPermissions: ['SendMessages'],
  runIn: ['GUILD_ANY'],
  aliases: ['bc']
})
export class BoostCountCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description), {
      behaviorWhenNotIdentical: RegisterBehavior.Overwrite
    });
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        embeds: [rich({ description: 'This command can only be used in a server.', kind: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await this.showBoostInfo(interaction, guild);
  }

  public override async messageRun(message: Message) {
    const guild = message.guild;
    if (!guild) {
      await message.reply({
        embeds: [rich({ description: 'This command can only be used in a server.', kind: 'warning' })],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    await this.showBoostInfo(message, guild);
  }

  private async showBoostInfo(source: ChatInputCommandInteraction | Message, guild: Guild) {
    const boostCount = guild.premiumSubscriptionCount || 0;
    const boostTier = String(guild.premiumTier ?? 0);
    const boostProgress = this.getBoostProgress(boostTier, boostCount);
    const isMessage = source instanceof Message;
    const payload = this.buildBoostPayload(guild, boostCount, boostTier, boostProgress, !isMessage);
    if (isMessage) {
      await source.reply({ ...payload, allowedMentions: { repliedUser: false } } as never);
    } else {
      await source.reply(payload as never);
    }
  }

  private buildBoostPayload(
    guild: Guild,
    boostCount: number,
    boostTier: string,
    boostProgress: string,
    ephemeral: boolean
  ) {
    const trimmedProgress = boostProgress.trim().replace(/^\(|\)$/g, '');
    const progressValue = trimmedProgress || '—';
    const fields: { name: string; value: string; icon?: string }[] = [
      { name: 'Boosts', value: `${boostCount}`, icon: 'boost' as const },
      { name: 'Tier', value: `${boostTier}`, icon: 'boost' as const }
    ];
    if (boostTier !== '4') fields.push({ name: 'Progress', value: progressValue, icon: 'info' as const });
    const blocks = boostTier === '4' ? ['-# Max tier reached'] : trimmedProgress ? [`-# ${trimmedProgress}`] : [];
    return v2({
      title: 'Server Boosts',
      subtitle: `${guild.name} • Tier ${boostTier}`,
      accent: 'info',
      thumbnailUrl: guild.iconURL({ size: 128 }),
      fields,
      blocks,
      footer: `ID ${guild.id}`,
      ephemeral
    });
  }

  private getBoostProgress(tier: string, count: number): string {
    const tierLimits: Record<string, number> = {
      '0': 0,
      '1': 2,
      '2': 7,
      '3': 14,
      '4': 30
    };

    const currentTierLimit = tierLimits[tier] || 0;
    const nextTier = String(Number(tier) + 1);
    const nextTierLimit = tierLimits[nextTier] || 0;

    if (tier === '4') {
      return ` (Max)`;
    }

    if (count < currentTierLimit) {
      return ` (${count}/${currentTierLimit} to next)`;
    }

    if (nextTierLimit > 0) {
      const progress = count - currentTierLimit;
      const remaining = nextTierLimit - currentTierLimit;
      return ` (${progress}/${remaining} to Tier ${nextTier})`;
    }

    return '';
  }
}
