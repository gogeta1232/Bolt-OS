import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  Guild,
  GuildMember,
  Message,
  PermissionFlagsBits,
  ChannelType,
  GuildBasedChannel,
  CategoryChannel,
  TextChannel,
  VoiceChannel,
  NewsChannel,
  StageChannel,
  ForumChannel,
  MediaChannel
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { checkModerationPermission } from '../../lib/utils/moderation-permission-checker.js';
import { collectEvidence } from '../../lib/evidence.js';

@ApplyOptions<Command.Options>({
  name: 'jail',
  description: 'Restrict a member to a specific channel, limiting their server access.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.SendMessages
  ]
})
export class JailCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to jail').setRequired(true))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for jail').setRequired(false))
          .addAttachmentOption((option) => option.setName('evidence').setDescription('Evidence attachment')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  private async checkModeratorPermissionsWithConfig(
    guild: Guild,
    member: GuildMember
  ): Promise<{
    hasPermission: boolean;
    config: { adminRoleIds: string[]; jailRoleId?: string | null; jailChannelId?: string | null };
  }> {
    const [permissionResult, config] = await Promise.all([
      checkModerationPermission(guild, member, member.id, 'jail'),
      this.container.config.fetch(guild.id).catch(() => ({ adminRoleIds: [], jailRoleId: null, jailChannelId: null }))
    ]);

    return { hasPermission: permissionResult.hasPermission, config };
  }

  /**
   * Type guard to check if a channel has permission overwrites
   * In Discord.js, not all channel types support permission overwrites (e.g., threads)
   */
  private hasPermissionOverwrites(
    channel: GuildBasedChannel | null | undefined
  ): channel is
    CategoryChannel | TextChannel | VoiceChannel | NewsChannel | StageChannel | ForumChannel | MediaChannel {
    return channel !== null && channel !== undefined && 'permissionOverwrites' in channel;
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await replyGuildOnly(interaction);
      return;
    }

    // Check if user has permission and get config in one call
    const { hasPermission, config } = await this.checkModeratorPermissionsWithConfig(
      guild,
      interaction.member as GuildMember
    );

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const member = interaction.options.getMember('target') as GuildMember | null;
    if (!member) {
      await replyToast(interaction, 'danger', 'Cannot find that member.');
      return;
    }
    const rawReason = interaction.options.getString('reason') ?? 'No reason provided';
    const slashAtt = interaction.options.getAttachment('evidence');
    const evidence = collectEvidence({
      reason: rawReason,
      slashAttachmentUrl: slashAtt?.url ?? null,
      slashAttachmentMeta: slashAtt ? { contentType: slashAtt.contentType, name: slashAtt.name } : null
    });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.applyJail(interaction, member, reason, evidence, config);
  }

  public override async messageRun(message: Message, args: Args) {
    void args;

    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }

    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const tokens = message.content.trim().split(/\s+/).slice(1);
    if (!tokens.length) {
      await replyToast(message, 'info', 'Usage: `!jail <member> [reason]`');
      return;
    }

    // Check if user has permission using shared method
    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const { hasPermission, config } = await this.checkModeratorPermissionsWithConfig(guild, member);

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    const memberResolved = resolution.member;
    if (!memberResolved) {
      await replyToast(message, 'warning', resolution.feedback ?? 'Could not find that member.');
      return;
    }
    const remainingTokens = tokens.slice(resolution.consumed);
    const rawReason = remainingTokens.join(' ').trim() || 'No reason provided';
    const evidence = collectEvidence({ reason: rawReason, attachments: message.attachments });
    const reason = evidence.length
      ? rawReason
          .replace(/https?:\/\/[^\s]+/gi, (m) => (evidence.includes(m) ? '' : m))
          .trim()
          .replace(/\s{2,}/g, ' ') || rawReason
      : rawReason;
    await this.applyJail(message, memberResolved, reason, evidence, config);
  }

  private async applyJail(
    source: ChatInputCommandInteraction | Message,
    member: GuildMember,
    reason: string,
    evidence: string[],
    config: { adminRoleIds: string[]; jailRoleId?: string | null; jailChannelId?: string | null }
  ) {
    this.container.logger.debug(
      `Starting jail process for member ${member.user.tag} (${member.id}) in guild ${member.guild.id}`
    );

    if (!member.moderatable) {
      await replyToast(source, 'warning', `Cannot jail ${member.user.tag}; missing permissions or role hierarchy.`);
      return;
    }

    try {
      const guild = member.guild;
      const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
      const moderatorId = source instanceof Message ? source.author.id : source.user.id;

      this.container.logger.debug(
        `Fetched config for guild ${guild.id}. Jail role ID: ${config.jailRoleId}, Jail channel ID: ${config.jailChannelId}`
      );

      // Check if jail role is configured
      if (!config.jailRoleId) {
        await replyToast(
          source,
          'warning',
          'Jail role is not configured for this guild. Please set a jail role using `!setjailrole <role>`.'
        );
        return;
      }

      const jailRole = guild.roles.cache.get(config.jailRoleId);
      if (!jailRole) {
        await replyToast(source, 'warning', 'Configured jail role could not be found. Please update your settings.');
        return;
      }

      this.container.logger.debug(`Jail role found: ${jailRole.name} (${jailRole.id})`);

      // Check bot's role hierarchy
      const me = guild.members.me;
      if (!me || me.roles.highest.comparePositionTo(jailRole) <= 0) {
        await replyToast(source, 'warning', 'Cannot assign the jail role due to role hierarchy.');
        return;
      }

      // Get member's original roles (excluding managed roles like bots get)
      const originalRoles = member.roles.cache
        .filter((role) => role.id !== guild.roles.everyone.id && !role.managed)
        .map((role) => role.id);

      this.container.logger.debug(`Storing original roles for ${member.user.tag}: ${originalRoles.join(', ')}`);

      // Add the jail role to the member
      await member.roles.add(jailRole, reason);
      this.container.logger.debug(`Added jail role to member ${member.user.tag}`);

      // If a jail channel is configured, move the member to that channel
      let jailChannel = config.jailChannelId ? guild.channels.cache.get(config.jailChannelId) : null;

      // Build success embed immediately to send to user
      let embedDescription = `${getEmoji('jail')} | **${member.user.tag}** has been **jailed**`;
      if (reason && reason !== 'No reason provided') {
        embedDescription += ` | **Reason:** ${reason}`;
      }

      // Send success message IMMEDIATELY before doing slow operations
      await replyToast(source, 'success', embedDescription);

      // Execute slow operations in background (no await) for better perceived performance
      void (async () => {
        try {
          // If jail channel is configured, set up permissions
          if (jailChannel && this.hasPermissionOverwrites(jailChannel)) {
            this.container.logger.debug(
              `Setting up jail channel permissions for ${member.user.tag} in channel ${jailChannel.name} (${jailChannel.id})`
            );

            // Filter channels that need permission updates (optimization)
            const channelsNeedingPerms = guild.channels.cache
              .filter((channel) => {
                // Skip jail channel
                if (channel.id === config.jailChannelId) return false;

                // Only process channels with permission overwrites (text, voice, news, stage, forum, media)
                if (!this.hasPermissionOverwrites(channel)) return false;

                // Only process specific channel types
                if (
                  channel.type !== ChannelType.GuildText &&
                  channel.type !== ChannelType.GuildVoice &&
                  channel.type !== ChannelType.GuildNews &&
                  channel.type !== ChannelType.GuildStageVoice &&
                  channel.type !== ChannelType.GuildForum &&
                  channel.type !== ChannelType.GuildMedia
                )
                  return false;

                // Skip if member already has no access
                const existingOverwrite = channel.permissionOverwrites.cache.get(member.id);
                if (existingOverwrite?.deny.has(PermissionFlagsBits.ViewChannel)) return false;

                return true;
              })
              // Cast to the proper type since we've validated it with the type predicate
              .map(
                (channel) =>
                  channel as
                    | CategoryChannel
                    | TextChannel
                    | VoiceChannel
                    | NewsChannel
                    | StageChannel
                    | ForumChannel
                    | MediaChannel
              );

            // Create ALL permission overwrites in PARALLEL for maximum speed
            const permissionPromises = channelsNeedingPerms.map((channel) =>
              channel.permissionOverwrites
                .create(member.id, {
                  ViewChannel: false,
                  SendMessages: false,
                  Connect: false
                })
                .catch((error: Error) => {
                  this.container.logger.warn(
                    `Failed to set channel permissions for ${member.user.tag} in ${channel.name}: ${error.message}`
                  );
                })
            );

            // Execute all permission updates simultaneously instead of sequentially
            await Promise.all(permissionPromises);

            // Give the member permission to view and send messages in the jail channel
            if (this.hasPermissionOverwrites(jailChannel)) {
              const jailChannelTyped = jailChannel as
                CategoryChannel | TextChannel | VoiceChannel | NewsChannel | StageChannel | ForumChannel | MediaChannel;
              await jailChannelTyped.permissionOverwrites
                .create(member.id, {
                  ViewChannel: true,
                  SendMessages: true,
                  ReadMessageHistory: true,
                  Connect: true,
                  Speak: true
                })
                .catch((error: Error) => {
                  this.container.logger.warn(
                    `Failed to set jail channel permissions for ${member.user.tag}: ${error.message}`
                  );
                });
            }
          }

          // Handle voice channel moves
          if (member.voice.channel && jailChannel && jailChannel.isVoiceBased()) {
            await member.voice.setChannel(jailChannel, 'Moved to jail channel').catch(() => {});
          } else if (member.voice.channel) {
            await member.voice.disconnect('Jailed from server').catch(() => {});
          }

          // Store original roles in the case record for restoration later
          const caseMetadata = { originalRoles };

          // Create case record - permanent jail (no expiration)
          const caseRecord = await this.container.cases.create({
            guildId: member.guild.id,
            action: 'jail',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId,
            moderatorTag,
            reason,
            evidence,
            expiresAt: undefined, // Permanent jail
            metadata: caseMetadata
          });

          // Build moderation context for permanent jail
          const moderationContext = buildModerationContext({
            actor: source instanceof Message ? source.author : source.user,
            target: member,
            reason,
            caseId: caseRecord.caseId,
            duration: 'Permanent'
          });

          if (evidence.length) {
            moderationContext.metadata = {
              Evidence: evidence.join(', ')
            };
          }

          const evidenceSummary = evidence.length ? `\n${getEmoji('evidence')} Evidence: ${evidence.join(', ')}` : '';

          // Send logs in parallel for better performance
          await Promise.all([
            this.container.logging.sendModerationLog(
              member.guild,
              `${getEmoji('jail')} Case #${caseRecord.caseId}: ${member.user.toString()} jailed by ${moderatorTag}`,
              moderationContext
            ),
            this.container.logging.sendCaseLog(
              member.guild,
              `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} jailed by ${moderatorTag}${evidenceSummary}`
            )
          ]);
        } catch (error) {
          this.container.logger.error({ err: error, guildId: member.guild.id }, 'Background jail operations failed');
        }
      })();
    } catch (error) {
      await replyToast(source, 'danger', `Failed to jail ${member.user.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: member.guild.id }, 'Jail command failed');
    }
  }
}
