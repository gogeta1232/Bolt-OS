import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  Message,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember
} from 'discord.js';

import { BotClient } from '../../lib/bot-client.js';
import { hasAdminAccess } from '../../lib/permissions.js';
import { replyContainer, replyGuildOnly, replyNoPermission, replyToast } from '../../lib/respond.js';
import { buildAccessContainer, describeAccess } from '../../lib/access-overview.js';
import { getMemberFakePermissions, normalizeStoredPermissions } from '../../lib/fake-permissions.js';

const USER_ID_PATTERN = /^\d{17,20}$/;

@ApplyOptions<Command.Options>({
  name: 'permissions',
  description: 'Show how access resolves — Discord keys vs Bolt roles.',
  aliases: ['access'],
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class PermissionsCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) =>
            option.setName('member').setDescription('Whose access to inspect (admins only).').setRequired(false)
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
    const requester = interaction.member as GuildMember | null;
    if (!requester) {
      await replyToast(interaction, 'warning', 'Could not identify the command executor.');
      return;
    }
    const targetUser = interaction.options.getUser('member') ?? interaction.user;
    const target =
      targetUser.id === requester.id
        ? requester
        : ((interaction.options.getMember('member') as GuildMember | null) ??
          (await guild.members.fetch(targetUser.id).catch(() => null)));
    if (!target) {
      await replyToast(interaction, 'warning', 'Could not find that member in this server.');
      return;
    }
    if (target.id !== requester.id && !(await hasAdminAccess(guild, requester, requester.id))) {
      await replyNoPermission(interaction);
      return;
    }
    await this.sendPanel(interaction, guild, target, target.id === requester.id);
  }

  public override async messageRun(message: Message, args: Args) {
    const guild = message.guild;
    if (!guild) {
      await replyGuildOnly(message);
      return;
    }
    const requester = message.member;
    if (!requester) {
      await replyToast(message, 'warning', 'Could not identify the command executor.');
      return;
    }
    const target = await this.resolvePrefixTarget(message, args, requester);
    if (!target) return;
    if (target.id !== requester.id && !(await hasAdminAccess(guild, requester, requester.id))) {
      await replyNoPermission(message);
      return;
    }
    await this.sendPanel(message, guild, target, target.id === requester.id);
  }

  private async resolvePrefixTarget(message: Message, args: Args, fallback: GuildMember): Promise<GuildMember | null> {
    const guild = message.guild;
    if (!guild) return null;
    const mentioned = message.mentions.members?.first() ?? null;
    if (mentioned) return mentioned;

    const raw = await args.pick('string').catch(() => null);
    if (!raw) return fallback;
    const id = raw.replace(/[^0-9]/g, '');
    if (USER_ID_PATTERN.test(id)) {
      const byId = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
      if (byId) return byId;
    }
    const resolved = await this.container.memberResolver.resolve(message, [raw]);
    if (resolved.member) return resolved.member;
    await replyToast(message, 'warning', resolved.feedback ?? 'Could not find that member.');
    return null;
  }

  private async sendPanel(
    source: ChatInputCommandInteraction | Message,
    guild: Guild,
    target: GuildMember,
    isSelf: boolean
  ) {
    const prefix = await this.resolveGuildPrefix(guild.id);
    let adminRoleIds: string[] = [];
    let modRoleIds: string[] = [];
    let fakePermissions: Record<string, string[]> = {};
    try {
      const config = await this.container.config.fetch(guild.id);
      adminRoleIds = config.adminRoleIds ?? [];
      modRoleIds = config.modRoleIds ?? [];
      fakePermissions = config.fakePermissions ?? {};
    } catch {
      adminRoleIds = [];
      modRoleIds = [];
      fakePermissions = {};
    }
    const matchNames = async (ids: string[]): Promise<string[]> => {
      const names: string[] = [];
      for (const roleId of ids) {
        if (!target.roles.cache.has(roleId)) continue;
        const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
        names.push(role?.name ?? roleId);
        if (names.length >= 5) break;
      }
      return names;
    };
    const matchedAdmin = await matchNames(adminRoleIds);
    const matchedMod = await matchNames(modRoleIds);
    const nativeKeys: string[] = [];
    if (target.permissions.has(PermissionFlagsBits.Administrator)) nativeKeys.push('Administrator');
    if (target.permissions.has(PermissionFlagsBits.ManageGuild)) nativeKeys.push('ManageGuild');

    const memberRoleIds = [...target.roles.cache.keys()];
    const effectiveFakePerms = [...getMemberFakePermissions(memberRoleIds, fakePermissions)].sort();
    const fakeRoleNames: string[] = [];
    for (const [roleId, perms] of Object.entries(fakePermissions)) {
      if (!target.roles.cache.has(roleId)) continue;
      const normalized = normalizeStoredPermissions(perms);
      if (normalized.length === 0) continue;
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      fakeRoleNames.push(role?.name ?? roleId);
      if (fakeRoleNames.length >= 5) break;
    }

    const accessInput = {
      tag: target.user.tag,
      userId: target.id,
      isOwner: guild.ownerId === target.id,
      nativeKeys,
      botRoleNames: matchedAdmin,
      modRoleNames: matchedMod,
      fakePerms: effectiveFakePerms,
      fakeRoleNames,
      botAdminConfigured: adminRoleIds.length > 0,
      botFakeConfigured: Object.keys(fakePermissions).length > 0,
      guildPrefix: prefix,
      isSelf
    };
    const view = describeAccess(accessInput);
    const container = buildAccessContainer({ view, input: accessInput });
    // WHY always ephemeral on slash: access panels name configured roles.
    await replyContainer(source, container, { ephemeral: true });
  }

  private async resolveGuildPrefix(guildId: string | null): Promise<string> {
    try {
      return await (this.container.client as BotClient).getGuildPrefix(guildId);
    } catch {
      return '!';
    }
  }
}
