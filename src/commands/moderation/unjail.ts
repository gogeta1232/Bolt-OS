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
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

@ApplyOptions<Command.Options>({
  name: 'unjail',
  description: 'Remove jail restrictions from a member.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages]
})
export class UnjailCommand extends Command {
  private async checkModeratorPermissions(guild: Guild, member: GuildMember): Promise<boolean> {
    return hasModerationPermission(guild, member, member.id, 'unjail');
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

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to unjail').setRequired(true))
          .addStringOption((option) => option.setName('reason').setDescription('Reason for unjail').setRequired(false)),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await replyGuildOnly(interaction);
      return;
    }

    // Check if user has permission using shared method
    const hasPermission = await this.checkModeratorPermissions(guild, interaction.member as GuildMember);

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const member = interaction.options.getMember('target') as GuildMember | null;
    if (!member) {
      await replyToast(interaction, 'danger', 'Cannot find that member.');
      return;
    }
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await this.applyUnjail(interaction, member, reason);
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
      await replyToast(message, 'info', 'Usage: `!unjail <member> [reason]`');
      return;
    }

    // Check if user has permission using shared method
    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    const hasPermission = await this.checkModeratorPermissions(guild, member);

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
    const reason = tokens.slice(resolution.consumed).join(' ').trim() || 'No reason provided';
    await this.applyUnjail(message, memberResolved, reason);
  }

  private async applyUnjail(source: ChatInputCommandInteraction | Message, member: GuildMember, reason: string) {
    this.container.logger.debug(
      `Starting unjail process for member ${member.user.tag} (${member.id}) in guild ${member.guild.id}`
    );

    if (!member.moderatable) {
      await replyToast(source, 'warning', `Cannot unjail ${member.user.tag}; missing permissions or role hierarchy.`);
      return;
    }

    try {
      const guild = member.guild;
      const config = await this.container.config.fetch(guild.id);
      const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
      const moderatorId = source instanceof Message ? source.author.id : source.user.id;

      this.container.logger.debug(
        `Fetched config for guild ${guild.id}. Jail role ID: ${config.jailRoleId}, Jail channel ID: ${config.jailChannelId}`
      );

      // Check if jail role is configured
      if (!config.jailRoleId) {
        await replyToast(source, 'warning', 'Jail role is not configured for this guild.');
        return;
      }

      const jailRole = guild.roles.cache.get(config.jailRoleId);
      if (!jailRole) {
        await replyToast(source, 'warning', 'Configured jail role could not be found.');
        return;
      }

      this.container.logger.debug(`Jail role found: ${jailRole.name} (${jailRole.id})`);

      // Check if member has the jail role
      if (!member.roles.cache.has(jailRole.id)) {
        await replyToast(source, 'info', `${member.user.tag} is not currently jailed.`);
        return;
      }

      // Find the most recent jail case for this member to get original roles
      const recentJailCases = await this.container.cases.listForUser(guild.id, member.id, 10, 0);
      const latestJailCase = recentJailCases.find((caseItem) => caseItem.action === 'jail');
      let originalRoles: string[] = [];

      if (latestJailCase && latestJailCase.metadata && Array.isArray(latestJailCase.metadata.originalRoles)) {
        originalRoles = latestJailCase.metadata.originalRoles;
        this.container.logger.debug(`Found original roles for ${member.user.tag}: ${originalRoles.join(', ')}`);
      } else {
        this.container.logger.warn(`Could not find original roles for ${member.user.tag} in jail case records`);
      }

      // Build success embed IMMEDIATELY to send to user
      let embedDescription = `${getEmoji('success')} | **${member.user.tag}** has been **unjailed**`;
      if (reason && reason !== 'No reason provided') {
        embedDescription += ` | **Reason:** ${reason}`;
      }

      // Send success message IMMEDIATELY before doing slow operations
      await replyToast(source, 'success', embedDescription);

      // Execute slow operations in background (no await) for better perceived performance
      void (async () => {
        try {
          // Remove the jail role from the member
          await member.roles.remove(jailRole, reason);
          this.container.logger.debug(`Removed jail role from member ${member.user.tag}`);

          // Restore original roles (excluding managed roles and @everyone)
          const rolesToRestore = originalRoles.filter((roleId) => {
            const role = guild.roles.cache.get(roleId);
            return role && !role.managed && roleId !== guild.roles.everyone.id;
          });

          // Restore roles in parallel for speed
          if (rolesToRestore.length > 0) {
            const roleRestorePromises = rolesToRestore.map((roleId) => {
              const role = guild.roles.cache.get(roleId);
              if (role) {
                return member.roles.add(role, 'Restored roles after unjail').catch((error: Error) => {
                  this.container.logger.warn(
                    `Failed to restore role ${role.name} to ${member.user.tag}: ${error.message}`
                  );
                });
              }
              return Promise.resolve();
            });

            // Execute all role restorations simultaneously
            await Promise.all(roleRestorePromises);
            this.container.logger.debug(`Restored ${rolesToRestore.length} roles to member ${member.user.tag}`);
          }

          // If a jail channel is configured, remove permissions and restore access
          if (config.jailChannelId) {
            const jailChannel = guild.channels.cache.get(config.jailChannelId);

            // Filter channels that need permission cleanup (optimization)
            const channelsNeedingCleanup = guild.channels.cache
              .filter((channel) => {
                // Skip jail channel (we handle it separately)
                if (channel.id === config.jailChannelId) return false;

                // Only process channels with permission overwrites
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

                // Skip if member doesn't have permission overwrites in this channel
                const existingOverwrite = channel.permissionOverwrites.cache.get(member.id);
                if (!existingOverwrite) return false;

                return true;
              })
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

            // Remove ALL permission overwrites in PARALLEL for maximum speed
            const permissionDeletePromises = channelsNeedingCleanup.map((channel) =>
              channel.permissionOverwrites.delete(member.id).catch((error: Error) => {
                this.container.logger.warn(
                  `Failed to restore channel permissions for ${member.user.tag} in ${channel.name}: ${error.message}`
                );
              })
            );

            // Execute all permission deletions simultaneously
            await Promise.all(permissionDeletePromises);

            // Remove the member's specific permission overwrites in the jail channel
            if (jailChannel && this.hasPermissionOverwrites(jailChannel)) {
              const jailChannelTyped = jailChannel as
                CategoryChannel | TextChannel | VoiceChannel | NewsChannel | StageChannel | ForumChannel | MediaChannel;
              await jailChannelTyped.permissionOverwrites.delete(member.id).catch((error: Error) => {
                this.container.logger.warn(
                  `Failed to remove jail channel permissions for ${member.user.tag}: ${error.message}`
                );
              });
            }
          }

          // Create case record
          const caseRecord = await this.container.cases.create({
            guildId: member.guild.id,
            action: 'unjail',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId,
            moderatorTag,
            reason,
            evidence: [],
            metadata: { originalRolesRestored: rolesToRestore }
          });

          // Build moderation context
          const moderationContext = buildModerationContext({
            actor: source instanceof Message ? source.author : source.user,
            target: member,
            reason,
            caseId: caseRecord.caseId
          });

          // Send logs
          await this.container.logging.sendModerationLog(
            member.guild,
            `${getEmoji('success')} Case #${caseRecord.caseId}: ${member.user.toString()} unjailed by ${moderatorTag}`,
            moderationContext
          );
          await this.container.logging.sendCaseLog(
            member.guild,
            `${getEmoji('case')} Case #${caseRecord.caseId} — ${member.user.toString()} unjailed by ${moderatorTag}`
          );
        } catch (error) {
          this.container.logger.error({ err: error, guildId: member.guild.id }, 'Background unjail operations failed');
        }
      })();
    } catch (error) {
      await replyToast(source, 'danger', `Failed to unjail ${member.user.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: member.guild.id }, 'Unjail command failed');
    }
  }
}
