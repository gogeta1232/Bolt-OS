import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, GuildMember, Message, PermissionFlagsBits, MessageFlags } from 'discord.js';

import { single, v2 } from '../../lib/embeds.js';

// ── Named constants ──
const AVATAR_SIZE = 128;
const BANNER_SIZE = 1024;
const MAX_NICKNAME_LENGTH = 32;
const MAX_VISIBLE_ROLES = 12;
const MILLISECONDS_PER_SECOND = 1000;

@ApplyOptions<Command.Options>({
  name: 'userinfo',
  aliases: ['whois', 'wi'],
  description: 'Inspect a member profile with roles and timestamps.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages', 'EmbedLinks']
})
export class UserInfoCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('target').setDescription('Member to inspect')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getMember('target') ?? interaction.member;
    if (!(target instanceof GuildMember)) {
      await interaction.reply({
        content: 'This command must be used in a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const payload = await this.buildV2(target);
    await interaction.reply(payload as unknown as Parameters<typeof interaction.reply>[0]);
  }

  public override async messageRun(message: Message, args: Args) {
    if (!message.guild) return;
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const resolvedMember = await this.resolveMemberFromArgs(message, args);
    if (!resolvedMember) return;
    if (resolvedMember.ambiguousFeedback) {
      await (channel as unknown as { send: (p: unknown) => Promise<void> }).send(
        single(resolvedMember.ambiguousFeedback, 'warning') as unknown as never
      );
      return;
    }
    if (!resolvedMember.member) return;
    const payload = await this.buildV2(resolvedMember.member);
    await (channel as unknown as { send: (p: unknown) => Promise<void> }).send(payload as unknown as never);
  }

  private async resolveMemberFromArgs(
    message: Message,
    args: Args
  ): Promise<{ member: GuildMember | null; ambiguousFeedback?: string } | null> {
    const peek = await args.peekResult('memberResolved');
    if (peek.isOk()) {
      const resolvedMember = await args.pick('memberResolved');
      await args.rest('string').catch(() => null);
      return { member: resolvedMember as GuildMember };
    }

    const remainder = await args.rest('string').catch(() => '');
    const tokens = remainder?.trim() ? remainder.trim().split(/\s+/).filter(Boolean) : [];
    if (tokens.length === 0) return { member: message.member ?? null };

    const resolution = await this.container.memberResolver.resolve(message, tokens);
    if (resolution.member) return { member: resolution.member };
    if (resolution.reason === 'ambiguous' && resolution.feedback)
      return { member: null, ambiguousFeedback: resolution.feedback };
    return { member: message.member ?? null };
  }

  /**
   * Builds V2 embed for member — orchestrates time/role/badge helpers.
   * @param guildMember - Target guild member to inspect
   * @returns V2 payload ready to send
   */
  private async buildV2(guildMember: GuildMember) {
    const { bannerUrl, avatarUrl } = await this.fetchMemberAssets(guildMember);
    const { joinedTimestampSeconds, createdTimestampSeconds, boostingTimestampSeconds } =
      this.resolveMemberTimestamps(guildMember);
    const fields = this.buildMemberTimeFields(
      joinedTimestampSeconds,
      createdTimestampSeconds,
      boostingTimestampSeconds
    );
    const blocks = await this.buildMemberInfoBlocks(guildMember);
    const accentColor =
      guildMember.displayColor && guildMember.displayColor !== 0 ? guildMember.displayColor : undefined;

    return v2({
      title: guildMember.user.tag,
      subtitle: `${guildMember.user.bot ? 'Bot' : 'Member'} • <@${guildMember.user.id}> • Joined <t:${joinedTimestampSeconds ?? createdTimestampSeconds}:R>`,
      accent: 'primary',
      accentColor,
      thumbnailUrl: avatarUrl,
      thumbnailAlt: guildMember.user.tag,
      fields,
      blocks,
      bannerUrl,
      footer: `ID ${guildMember.user.id} • Created <t:${createdTimestampSeconds}:f>`
    });
  }

  private async fetchMemberAssets(guildMember: GuildMember): Promise<{ bannerUrl: string | null; avatarUrl: string }> {
    const fetchedUser = await this.container.client.users.fetch(guildMember.user.id, { force: true }).catch(() => null);
    const bannerUrl = fetchedUser?.bannerURL({ size: BANNER_SIZE }) ?? null;
    const avatarUrl = guildMember.user.displayAvatarURL({ size: AVATAR_SIZE });
    return { bannerUrl, avatarUrl };
  }

  private resolveMemberTimestamps(guildMember: GuildMember) {
    const joinedTimestampSeconds = guildMember.joinedTimestamp
      ? Math.floor(guildMember.joinedTimestamp / MILLISECONDS_PER_SECOND)
      : null;
    const createdTimestampSeconds = Math.floor(guildMember.user.createdTimestamp / MILLISECONDS_PER_SECOND);
    const boostingTimestampSeconds = guildMember.premiumSinceTimestamp
      ? Math.floor(guildMember.premiumSinceTimestamp / MILLISECONDS_PER_SECOND)
      : null;
    return { joinedTimestampSeconds, createdTimestampSeconds, boostingTimestampSeconds };
  }

  private buildMemberTimeFields(joinedTs: number | null, createdTs: number, boostingTs: number | null) {
    return [
      { name: 'Joined', value: joinedTs ? `<t:${joinedTs}:R>` : 'Unknown', icon: 'calendar' as const },
      { name: 'Created', value: `<t:${createdTs}:R>`, icon: 'birthday' as const },
      { name: 'Boost', value: boostingTs ? `<t:${boostingTs}:R>` : '—', icon: 'boost' as const }
    ];
  }

  private async buildMemberInfoBlocks(guildMember: GuildMember): Promise<string[]> {
    let infoBlocks: string[] = [];
    infoBlocks = [...infoBlocks, this.buildNickIdBlock(guildMember)];
    infoBlocks = [...infoBlocks, this.buildRoleBlock(guildMember)];
    const badgeBlock = await this.buildBadgeBlock(guildMember);
    if (badgeBlock) infoBlocks = [...infoBlocks, badgeBlock];
    const permBlock = this.buildKeyPermsBlock(guildMember);
    if (permBlock) infoBlocks = [...infoBlocks, permBlock];
    return infoBlocks;
  }

  private buildNickIdBlock(guildMember: GuildMember): string {
    const truncatedNickname = guildMember.nickname ? guildMember.nickname.slice(0, MAX_NICKNAME_LENGTH) : null;
    const nickLine = truncatedNickname ? `**Nick:** \`${truncatedNickname}\`  •  ` : '';
    return `${nickLine}**ID:** \`${guildMember.user.id}\`  •  **Bot:** ${guildMember.user.bot ? 'Yes' : 'No'}`;
  }

  private buildRoleBlock(guildMember: GuildMember): string {
    const filteredRoles = guildMember.roles.cache
      .filter((role) => role.id !== role.guild.id)
      .sort((a, b) => b.position - a.position);
    if (filteredRoles.size === 0) return `**Roles:** —`;
    const shownRoles = filteredRoles
      .first(MAX_VISIBLE_ROLES)
      .map((role) => role.toString())
      .join(' ');
    const overflowSuffix = filteredRoles.size > MAX_VISIBLE_ROLES ? ` +${filteredRoles.size - MAX_VISIBLE_ROLES}` : '';
    return `**Roles [${filteredRoles.size}]${overflowSuffix}:** ${shownRoles}`;
  }

  private async buildBadgeBlock(guildMember: GuildMember): Promise<string | null> {
    try {
      const userFlags = await guildMember.user.fetchFlags();
      const badgeArray = userFlags.toArray();
      if (badgeArray.length === 0) return null;
      const formattedBadges = badgeArray
        .map((permissionFlagName) => `\`${this.humanizeFlagName(permissionFlagName)}\``)
        .join(' ');
      return `**Badges:** ${formattedBadges}`;
    } catch {
      return null;
    }
  }

  private buildKeyPermsBlock(guildMember: GuildMember): string | null {
    const keyPermissions = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers
    ];
    const hasKeyPerms = keyPermissions.filter((permission) => guildMember.permissions.has(permission));
    if (hasKeyPerms.length === 0) return null;
    const permNames: Record<string, string> = {
      [PermissionFlagsBits.Administrator.toString()]: 'Admin',
      [PermissionFlagsBits.ManageGuild.toString()]: 'Manage Guild',
      [PermissionFlagsBits.ManageRoles.toString()]: 'Manage Roles',
      [PermissionFlagsBits.ManageChannels.toString()]: 'Manage Channels',
      [PermissionFlagsBits.KickMembers.toString()]: 'Kick',
      [PermissionFlagsBits.BanMembers.toString()]: 'Ban',
      [PermissionFlagsBits.ModerateMembers.toString()]: 'Timeout'
    };
    const formattedPerms = hasKeyPerms
      .map((permissionBit) => `\`${permNames[permissionBit.toString()] ?? String(permissionBit)}\``)
      .join(' ');
    return `**Key Perms:** ${formattedPerms}`;
  }

  /**
   * Humanizes Discord flag key to Title Case.
   * @param permissionFlagName - Raw flag like STAFF or HYPESQUAD_EVENTS
   * @returns Human readable string
   */
  private humanizeFlagName(permissionFlagName: string): string {
    return permissionFlagName
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (firstLetter) => firstLetter.toUpperCase());
  }
}
