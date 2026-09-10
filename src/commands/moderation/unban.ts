import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message, type ChatInputCommandInteraction, type Guild, type GuildMember, type User } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { v2 } from '../../lib/embeds.js';
import { replyNoPermission, replyGuildOnly, replyToast } from '../../lib/respond.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

interface UnbanTarget {
  id: string;
  tag: string;
  mention: string;
  user: User | null;
}

@ApplyOptions<Command.Options>({
  name: 'unban',
  description: 'Revoke a ban so a user can rejoin.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['BanMembers', 'SendMessages']
})
export class UnbanCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Banned user to unban').setRequired(true))
          .addStringOption((option) =>
            option.setName('reason').setDescription('Reason for unbanning').setRequired(false)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await replyGuildOnly(interaction);
      return;
    }

    // Use optimized permission checker
    const hasPermission = await hasModerationPermission(
      guild,
      interaction.member as GuildMember,
      interaction.user.id,
      'unban'
    );

    if (!hasPermission) {
      await replyNoPermission(interaction);
      return;
    }

    const user = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await this.performUnban(interaction, this.buildUnbanTarget(user), reason);
  }

  public override async messageRun(message: Message, args: Args) {
    const guild = message.guild;
    if (!guild) return;

    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const member = message.member;
    if (!member) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }

    // Use optimized permission checker
    const hasPermission = await hasModerationPermission(guild, member, member.id, 'unban');

    if (!hasPermission) {
      await replyNoPermission(message);
      return;
    }

    const targetInput = await args.pick('string').catch(() => null);
    if (!targetInput) {
      await replyToast(message, 'info', 'Usage: `!unban <userId|@mention> [reason]`');
      return;
    }

    const idMatch = targetInput.match(/\d{17,20}/u);
    if (!idMatch) {
      await replyToast(message, 'warning', 'Provide a valid user id or mention.');
      return;
    }

    const reasonRemainder = await args.rest('string').catch(() => null);
    const reason =
      reasonRemainder?.trim() && reasonRemainder.length > 0 ? reasonRemainder.trim() : 'No reason provided';

    await this.performUnban(message, this.buildUnbanTarget(null, idMatch[0]), reason);
  }

  private async performUnban(source: ChatInputCommandInteraction | Message, target: UnbanTarget, reason: string) {
    const guild = source.guild;
    if (!guild) {
      if (source instanceof Message) return;
      await replyGuildOnly(source);
      return;
    }

    const moderatorTag = source instanceof Message ? source.author.tag : source.user.tag;
    const moderatorId = source instanceof Message ? source.author.id : source.user.id;
    const actor = source instanceof Message ? source.author : source.user;

    const banEntry = await guild.bans.fetch(target.id).catch(() => null);

    if (!banEntry) {
      await replyToast(source, 'warning', `${target.tag} is not currently banned.`);
      return;
    }

    const resolvedTarget = this.buildUnbanTarget(banEntry.user ?? target.user, target.id);

    try {
      await guild.members.unban(resolvedTarget.id, reason);
    } catch (error) {
      await replyToast(source, 'danger', `Failed to unban ${resolvedTarget.tag}: ${(error as Error).message}`);
      this.container.logger.error({ err: error, guildId: guild.id }, 'Unban command failed');
      return;
    }

    const successDescription = `${getEmoji('unban')} ${resolvedTarget.tag} unbanned${banEntry.reason ? ` • Previous ban reason: ${banEntry.reason}` : ''}`;
    await replyToast(source, 'success', successDescription);
    this.finishUnbanAfterResponse(
      guild,
      resolvedTarget,
      reason,
      banEntry.reason ?? null,
      moderatorId,
      moderatorTag,
      actor
    );
  }

  private finishUnbanAfterResponse(
    guild: Guild,
    target: UnbanTarget,
    reason: string,
    previousReason: string | null,
    moderatorId: string,
    moderatorTag: string,
    actor: User
  ) {
    void (async () => {
      const user = target.user ?? (await this.container.client.users.fetch(target.id).catch(() => null));
      const resolvedTarget = this.buildUnbanTarget(user, target.id);

      const [caseResult, dmResult] = await Promise.allSettled([
        this.container.cases.create({
          guildId: guild.id,
          action: 'unban',
          targetId: resolvedTarget.id,
          targetTag: resolvedTarget.tag,
          moderatorId,
          moderatorTag,
          reason,
          evidence: []
        }),
        resolvedTarget.user
          ? resolvedTarget.user.send(
              v2({
                title: 'Unbanned',
                subtitle: guild.name,
                accent: 'success',
                blocks: [reason],
                footer: 'You may rejoin with a fresh invite.'
              }) as never
            )
          : Promise.resolve()
      ]);

      if (dmResult.status === 'rejected') {
        this.container.logger.debug({ guildId: guild.id, userId: resolvedTarget.id }, 'Unable to DM unbanned user');
      }

      if (caseResult.status === 'rejected') {
        this.container.logger.error(
          { err: caseResult.reason, guildId: guild.id, userId: resolvedTarget.id },
          'Failed to create unban case'
        );
        return;
      }

      const moderationContext = buildModerationContext({
        actor,
        target: resolvedTarget.user,
        reason,
        caseId: caseResult.value.caseId
      });

      moderationContext.metadata = {
        'Previous Ban Reason': previousReason ?? 'Not recorded'
      };

      await Promise.all([
        this.container.logging.sendModerationLog(
          guild,
          `${getEmoji('unban')} Case #${caseResult.value.caseId}: ${resolvedTarget.mention} unbanned by ${moderatorTag}`,
          moderationContext
        ),
        this.container.logging.sendCaseLog(
          guild,
          `${getEmoji('case')} Case #${caseResult.value.caseId} — ${resolvedTarget.mention} unbanned by ${moderatorTag}`
        )
      ]);
    })().catch((error) => {
      this.container.logger.error(
        { err: error, guildId: guild.id, userId: target.id },
        'Failed to finish unban background work'
      );
    });
  }

  private buildUnbanTarget(user: User | null, idOverride?: string): UnbanTarget {
    const id = user?.id ?? idOverride;
    if (!id) {
      throw new Error('Cannot build unban target without a user ID.');
    }

    return {
      id,
      tag: user?.tag ?? `User ID ${id}`,
      mention: `<@${id}>`,
      user
    };
  }
}
