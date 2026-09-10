import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import {
  type ChatInputCommandInteraction,
  type Guild,
  type GuildPremiumTier,
  Message,
  ChannelType,
  MessageFlags
} from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { fetchGuildMemberStats, type GuildMemberStats } from '../../lib/guild-member-stats.js';

// ── Named constants ──
const MILLISECONDS_PER_SECOND = 1000;
const EMBED_THUMBNAIL_SIZE = 512;
const EMBED_BANNER_SIZE = 1024;
const VERIFICATION_LEVELS = ['None', 'Low', 'Medium', 'High', 'Very High'] as const;

interface ChannelStats {
  textChannels: number;
  voiceChannels: number;
  categories: number;
  announcementChannels: number;
  threads: number;
}

@ApplyOptions<Command.Options>({
  name: 'serverinfo',
  aliases: ['server', 'si'],
  description: 'Summarize the current server at a glance.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class ServerInfoCommand extends Command {
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

    await interaction.reply({
      embeds: [await this.buildEmbed(interaction.guild)]
    });
  }

  public override async messageRun(message: Message) {
    if (!message.guild) return;
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;
    await channel.send({ embeds: [await this.buildEmbed(message.guild)] });
  }

  /**
   * Orchestrates guild data fetching and embed building — delegates to helpers to stay <50 lines.
   * @param guild - Guild to summarize
   * @returns Discord embed with server overview
   */
  private async buildEmbed(guild: Guild) {
    try {
      const [owner, memberStats, channelStats] = await Promise.all([
        guild.fetchOwner().catch(() => null),
        fetchGuildMemberStats(guild),
        Promise.resolve(this.resolveChannelStats(guild))
      ]);

      const description = this.buildDescription(guild, owner, memberStats, channelStats);
      return this.createServerEmbed(guild, description);
    } catch (error) {
      throw new Error(`Failed to build server info embed for guild ${guild.id}: ${(error as Error).message}`);
    }
  }

  private resolveChannelStats(guild: Guild): ChannelStats {
    const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildVoice).size;
    const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size;
    const announcementChannels = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildAnnouncement
    ).size;
    const threads = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread
    ).size;
    return { textChannels, voiceChannels, categories, announcementChannels, threads };
  }

  private buildDescription(
    guild: Guild,
    owner: Awaited<ReturnType<Guild['fetchOwner']>> | null,
    memberStats: GuildMemberStats,
    channelStats: ChannelStats
  ): string {
    const headerLines = this.buildHeaderLines(guild, owner);
    const memberLines = this.buildMemberLines(guild, memberStats);
    const channelLines = this.buildChannelLines(guild, channelStats);
    const statsLines = this.buildServerStatsLines(guild);
    const securityLines = this.buildSecurityLines(guild);
    const allLines = [...headerLines, ...memberLines, ...channelLines, ...statsLines, ...securityLines];
    return allLines.join('\n');
  }

  private buildHeaderLines(guild: Guild, owner: Awaited<ReturnType<Guild['fetchOwner']>> | null): string[] {
    const createdSeconds = Math.floor(guild.createdTimestamp / MILLISECONDS_PER_SECOND);
    let lines: string[] = [
      `### ${getEmoji('settings')} Server Information`,
      ``,
      `> **Name:** ${guild.name}`,
      `> **ID:** \`${guild.id}\``,
      `> **Owner:** ${owner ? owner.user : 'Unknown'}`,
      `> **Created:** <t:${createdSeconds}:f> (<t:${createdSeconds}:R>)`,
      ``
    ];
    if (!guild.description) return lines;
    lines = [...lines, `**Description:**`, `> ${guild.description}`, ``];
    return lines;
  }

  private buildMemberLines(guild: Guild, memberStats: GuildMemberStats): string[] {
    return [
      `**Members:**`,
      `> ${getEmoji('member')} **Total:** \`${guild.memberCount.toLocaleString()}\``,
      `> ${getEmoji('humans')} **Humans:** \`${memberStats.humans.toLocaleString()}\``,
      `> ${getEmoji('bots')} **Bots:** \`${memberStats.bots.toLocaleString()}\``,
      ``
    ];
  }

  private buildChannelLines(guild: Guild, channelStats: ChannelStats): string[] {
    return [
      `**Channels:**`,
      `> ${getEmoji('channel')} **Total:** \`${guild.channels.cache.size}\``,
      `> ${getEmoji('text')} **Text:** \`${channelStats.textChannels}\``,
      `> ${getEmoji('voice')} **Voice:** \`${channelStats.voiceChannels}\``,
      `> ${getEmoji('announcement')} **Announcement:** \`${channelStats.announcementChannels}\``,
      `> ${getEmoji('category')} **Categories:** \`${channelStats.categories}\``,
      `> ${getEmoji('thread')} **Threads:** \`${channelStats.threads}\``,
      ``
    ];
  }

  private buildServerStatsLines(guild: Guild): string[] {
    const boosts = guild.premiumSubscriptionCount ?? 0;
    const tierLabel = this.formatTier(guild.premiumTier);
    return [
      `**Server Stats:**`,
      `> ${getEmoji('role')} **Roles:** \`${guild.roles.cache.size}\``,
      `> ${getEmoji('emoji')} **Emojis:** \`${guild.emojis.cache.size}\``,
      `> ${getEmoji('sticker')} **Stickers:** \`${guild.stickers.cache.size}\``,
      `> ${getEmoji('boost')} **Boosts:** \`${boosts}\` (Tier ${tierLabel})`,
      ``
    ];
  }

  private buildSecurityLines(guild: Guild): string[] {
    const verificationLevel = VERIFICATION_LEVELS[guild.verificationLevel] ?? 'Unknown';
    const twoFactorLabel = guild.mfaLevel === 1 ? 'Yes' : 'No';
    return [
      `**Security:**`,
      `> ${getEmoji('security')} **Verification Level:** ${verificationLevel}`,
      `> ${getEmoji('lock')} **2FA Required:** ${twoFactorLabel}`,
      `> ${getEmoji('nsfw')} **NSFW Level:** ${this.formatNsfwLevel(guild.nsfwLevel)}`
    ];
  }

  private createServerEmbed(guild: Guild, description: string) {
    const embed = createEmbed({
      description,
      type: 'info',
      styled: false,
      footer: `Server ID: ${guild.id}`,
      timestamp: true
    });
    const iconUrl = guild.iconURL({ size: EMBED_THUMBNAIL_SIZE });
    if (iconUrl) embed.setThumbnail(iconUrl);
    const bannerUrl = guild.bannerURL({ size: EMBED_BANNER_SIZE });
    if (bannerUrl) embed.setImage(bannerUrl);
    return embed;
  }

  private formatTier(tier: GuildPremiumTier): string {
    switch (tier) {
      case 3:
        return '3';
      case 2:
        return '2';
      case 1:
        return '1';
      default:
        return '0';
    }
  }

  private formatNsfwLevel(level: number): string {
    switch (level) {
      case 0:
        return 'Default';
      case 1:
        return 'Explicit';
      case 2:
        return 'Safe';
      case 3:
        return 'Age Restricted';
      default:
        return 'Unknown';
    }
  }
}
