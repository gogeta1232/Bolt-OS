import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
  TextChannel
} from 'discord.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { BotClient } from '../../lib/bot-client.js';
import { getEmoji } from '../../config/emojis.js';
import { createDangerEmbed, createSuccessEmbed } from '../../lib/single-line-embed.js';
import {
  FAKE_PERMISSION_CHOICES,
  FAKE_PERMISSION_DESCRIPTIONS,
  FAKE_PERMISSION_PRESETS,
  MAX_FAKE_PERMS_PER_ROLE,
  MAX_FAKE_ROLES_PER_GUILD,
  formatPermissionList,
  getMemberFakePermissions,
  normalizeStoredPermissions,
  parsePermissionTokens
} from '../../lib/fake-permissions.js';

type Subcommand = 'add' | 'remove' | 'list' | 'clear' | 'show' | 'guide';

const SUBCOMMANDS: readonly Subcommand[] = ['add', 'remove', 'list', 'clear', 'show', 'guide'] as const;

const CHOICES_SUMMARY = FAKE_PERMISSION_CHOICES.join(', ');
const PRESETS_SUMMARY = Object.keys(FAKE_PERMISSION_PRESETS).join(', ');

@ApplyOptions<Command.Options>({
  name: 'givepermission',
  aliases: ['gp', 'fakeperm', 'fp'],
  description: 'Grant granular fake permissions to roles — no Discord perms needed.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class GivePermissionCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription('Grant granular fake permissions to roles — no Discord perms needed')
          .addSubcommand((sub) =>
            sub
              .setName('add')
              .setDescription('Grant fake permissions to a role')
              .addRoleOption((option) =>
                option.setName('role').setDescription('Role to grant fake permissions').setRequired(true)
              )
              .addStringOption((option) =>
                option
                  .setName('permissions')
                  .setDescription(
                    'Permissions: admin, ban, unban, softban, kick, timeout, untimeout, warn, mute, unmute, jail, unjail, purge, slowmode, nick, role, voice, hide, unhide, cases — presets: chatmod, mod, seniormod, full, all (admin owner only)'
                  )
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove fake permissions from a role')
              .addRoleOption((option) =>
                option.setName('role').setDescription('Role to revoke fake permissions from').setRequired(true)
              )
              .addStringOption((option) =>
                option.setName('permissions').setDescription('Permissions to remove').setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('list')
              .setDescription('List fake permissions')
              .addRoleOption((option) =>
                option.setName('role').setDescription('Role to inspect (omit to list all)').setRequired(false)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('clear')
              .setDescription('Clear all fake permissions from a role')
              .addRoleOption((option) => option.setName('role').setDescription('Role to clear').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('show')
              .setDescription('Show effective fake permissions for a member')
              .addUserOption((option) =>
                option.setName('member').setDescription('Member to inspect').setRequired(false)
              )
          )
          .addSubcommand((sub) => sub.setName('guide').setDescription('Show setup guide and all choices')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply(createDangerEmbed('This command can only be used in a server', true));
      return;
    }
    await this.ensureAdmin(interaction);
    const sub = interaction.options.getSubcommand(true) as Subcommand;
    const executor = interaction.member as GuildMember | null;
    switch (sub) {
      case 'add': {
        const role = interaction.options.getRole('role', true) as Role;
        const permsRaw = interaction.options.getString('permissions', true);
        if (this.containsAdminPerm(permsRaw) && !this.isOwner(guild, executor)) {
          await interaction.reply(createDangerEmbed('Only the server owner can grant fake Administrator.', true));
          return;
        }
        const description = await this.addPermissions(guild, role.id, permsRaw);
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
      case 'remove': {
        const role = interaction.options.getRole('role', true) as Role;
        const permsRaw = interaction.options.getString('permissions', true);
        if (this.containsAdminPerm(permsRaw) && !this.isOwner(guild, executor)) {
          await interaction.reply(createDangerEmbed('Only the server owner can revoke fake Administrator.', true));
          return;
        }
        const description = await this.removePermissions(guild, role.id, permsRaw);
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
      case 'list': {
        const role = interaction.options.getRole('role') as Role | null;
        const description = await this.listPermissions(guild, role?.id ?? null);
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
      case 'clear': {
        const role = interaction.options.getRole('role', true) as Role;
        if ((await this.roleHasFakeAdmin(guild.id, role.id)) && !this.isOwner(guild, executor)) {
          await interaction.reply(createDangerEmbed('Only the server owner can clear fake Administrator.', true));
          return;
        }
        const description = await this.clearPermissions(guild, role.id);
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
      case 'show': {
        const user = interaction.options.getUser('member') ?? interaction.user;
        const member =
          (interaction.options.getMember('member') as GuildMember | null) ??
          (await guild.members.fetch(user.id).catch(() => null));
        if (!member) {
          await interaction.reply(createDangerEmbed('Could not find that member in this server.', true));
          return;
        }
        const description = await this.showMemberPermissions(guild, member);
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
      case 'guide': {
        const description = this.buildGuideDescription(await this.resolveGuildPrefix(guild.id));
        await interaction.reply(createSuccessEmbed(description, true));
        break;
      }
    }
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    const guild = message.guild;
    if (!guild) {
      await (message.channel as TextChannel).send(
        createDangerEmbed('This command can only be used in a server', false)
      );
      return;
    }
    await this.ensureAdmin(message);
    const rawSub = await args.pick('string').catch(() => null);
    const sub = this.resolvePrefixSubcommand(message, rawSub);
    // Shorthand: !gp @role kick ban -> add
    if (sub === null && rawSub) {
      const maybeRole = await this.tryPickRole(message, args, rawSub);
      if (maybeRole) {
        const permsRaw = await args.rest('string').catch(() => '');
        if (!permsRaw.trim()) {
          await (message.channel as TextChannel).send(
            createDangerEmbed(
              'Usage: gp @role <permissions>  ·  gp add @role <perms>  ·  gp remove @role <perms>',
              false
            )
          );
          return;
        }
        if (this.containsAdminPerm(permsRaw) && !this.isOwner(guild, message.member as GuildMember | null)) {
          await (message.channel as TextChannel).send(
            createDangerEmbed('Only the server owner can grant fake Administrator.', false)
          );
          return;
        }
        const description = await this.addPermissions(guild, maybeRole.id, permsRaw);
        await (message.channel as TextChannel).send(createSuccessEmbed(description, false));
        return;
      }
    }
    const channel = message.channel as TextChannel;
    if (!sub) {
      await channel.send(
        createDangerEmbed(
          `Usage: gp add @role <perms> | gp remove @role <perms> | gp list [@role] | gp clear @role | gp show [@user] | gp guide\nChoices: ${CHOICES_SUMMARY}\nPresets: ${PRESETS_SUMMARY}, all`,
          false
        )
      );
      return;
    }
    switch (sub) {
      case 'add': {
        const role = await args.pick('role').catch(() => null);
        if (!role) {
          await channel.send(createDangerEmbed('Usage: gp add <@role> <permissions>', false));
          return;
        }
        const permsRaw = await args.rest('string').catch(() => '');
        if (!permsRaw.trim()) {
          await channel.send(
            createDangerEmbed(`Specify permissions: ${CHOICES_SUMMARY} — presets: ${PRESETS_SUMMARY}, all`, false)
          );
          return;
        }
        if (this.containsAdminPerm(permsRaw) && !this.isOwner(guild, message.member as GuildMember | null)) {
          await channel.send(createDangerEmbed('Only the server owner can grant fake Administrator.', false));
          return;
        }
        const description = await this.addPermissions(guild, (role as Role).id, permsRaw);
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
      case 'remove': {
        const role = await args.pick('role').catch(() => null);
        if (!role) {
          await channel.send(createDangerEmbed('Usage: gp remove <@role> <permissions>', false));
          return;
        }
        const permsRaw = await args.rest('string').catch(() => '');
        if (!permsRaw.trim()) {
          await channel.send(createDangerEmbed('Specify permissions to remove.', false));
          return;
        }
        if (this.containsAdminPerm(permsRaw) && !this.isOwner(guild, message.member as GuildMember | null)) {
          await channel.send(createDangerEmbed('Only the server owner can revoke fake Administrator.', false));
          return;
        }
        const description = await this.removePermissions(guild, (role as Role).id, permsRaw);
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
      case 'list': {
        const role = await args.pick('role').catch(() => null);
        const description = await this.listPermissions(guild, (role as Role | null)?.id ?? null);
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
      case 'clear': {
        const role = await args.pick('role').catch(() => null);
        if (!role) {
          await channel.send(createDangerEmbed('Usage: gp clear <@role>', false));
          return;
        }
        if (
          (await this.roleHasFakeAdmin(guild.id, (role as Role).id)) &&
          !this.isOwner(guild, message.member as GuildMember | null)
        ) {
          await channel.send(createDangerEmbed('Only the server owner can clear fake Administrator.', false));
          return;
        }
        const description = await this.clearPermissions(guild, (role as Role).id);
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
      case 'guide': {
        const description = this.buildGuideDescription(await this.resolveGuildPrefix(guild.id));
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
      case 'show': {
        const mentionMember = message.mentions.members?.first() ?? null;
        let target: GuildMember | null = mentionMember;
        if (!target) {
          const raw = await args.pick('string').catch(() => null);
          if (raw) {
            const id = raw.replace(/[^0-9]/g, '');
            if (/^\d{17,20}$/.test(id)) {
              target = (guild.members.cache.get(id) ??
                (await guild.members.fetch(id).catch(() => null))) as GuildMember | null;
            } else {
              const resolved = await this.container.memberResolver.resolve(message, [raw]);
              target = resolved.member as GuildMember | null;
            }
          }
        }
        if (!target) target = message.member as GuildMember | null;
        if (!target) {
          await channel.send(createDangerEmbed('Could not find that member.', false));
          return;
        }
        const description = await this.showMemberPermissions(guild, target);
        await channel.send(createSuccessEmbed(description, false));
        break;
      }
    }
  }

  private resolvePrefixSubcommand(message: Message, raw: string | null): Subcommand | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (
      message.mentions.roles.size > 0 &&
      (lower.includes('<@&') || /^\d{17,20}$/.test(lower.replace(/[^0-9]/g, '')))
    ) {
      return null;
    }
    if (['add', 'grant', '+', 'give'].includes(lower)) return 'add';
    if (['remove', 'revoke', 'rm', '-', 'delete', 'del'].includes(lower)) return 'remove';
    if (['list', 'ls', 'view'].includes(lower)) return 'list';
    if (['clear', 'reset', 'wipe'].includes(lower)) return 'clear';
    if (['show', 'member', 'who'].includes(lower)) return 'show';
    if (['guide', 'help', 'choices', 'presets'].includes(lower)) return 'guide';
    if (SUBCOMMANDS.includes(lower as Subcommand)) return lower as Subcommand;
    const known = new Set<string>(SUBCOMMANDS);
    if (!known.has(lower)) return null;
    return lower as Subcommand;
  }

  private async tryPickRole(message: Message, _args: Args, raw: string): Promise<Role | null> {
    const guild = message.guild;
    if (!guild) return null;
    const mentioned = message.mentions.roles.first() ?? null;
    if (mentioned) return mentioned;
    const id = raw.replace(/[^0-9]/g, '');
    if (/^\d{17,20}$/.test(id)) {
      const byId = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null)) ?? null;
      if (byId) return byId as Role;
    }
    const lower = raw.toLowerCase();
    const byName =
      guild.roles.cache.find((role) => role.name.toLowerCase() === lower) ??
      guild.roles.cache.find((role) => role.name.toLowerCase().includes(lower)) ??
      null;
    if (byName) return byName;
    return null;
  }

  private async addPermissions(guild: Guild, roleId: string, permsRaw: string): Promise<string> {
    const { valid, invalid } = parsePermissionTokens([permsRaw]);
    if (invalid.length > 0) {
      return `${getEmoji('danger')} Invalid permissions: ${invalid.map((perm) => `\`${perm}\``).join(', ')}\n-# Allowed: ${CHOICES_SUMMARY}\n-# Presets: ${PRESETS_SUMMARY}, all — \`admin\` is owner only`;
    }
    if (valid.length === 0) {
      return `${getEmoji('danger')} No valid permissions provided.\n-# Try: \`${CHOICES_SUMMARY}\` — presets: \`${PRESETS_SUMMARY}, all\` — \`admin\` is owner only.`;
    }
    const config = await this.container.config.fetch(guild.id);
    const fakePermissions: Record<string, string[]> = { ...(config.fakePermissions ?? {}) };
    const existing = normalizeStoredPermissions(fakePermissions[roleId] ?? []);
    const merged = [...new Set([...existing, ...valid])].sort().slice(0, MAX_FAKE_PERMS_PER_ROLE);
    const added = merged.filter((perm) => !existing.includes(perm));
    if (added.length === 0) {
      return `${getEmoji('info')} No changes — role already has ${formatPermissionList(existing)}`;
    }
    if (!fakePermissions[roleId] && Object.keys(fakePermissions).length >= MAX_FAKE_ROLES_PER_GUILD) {
      return `${getEmoji('danger')} Limit reached — max ${MAX_FAKE_ROLES_PER_GUILD} roles can have fake permissions. Clear one first.`;
    }
    fakePermissions[roleId] = merged;
    await this.container.config.set(guild.id, { fakePermissions });
    const role = await guild.roles.fetch(roleId).catch(() => null);
    await this.container.logging.sendAuditLog(
      guild,
      `${getEmoji('embedAdd')} Fake perms granted to ${role?.toString() ?? roleId}: ${added.join(', ')}`
    );
    return `${getEmoji('target')} **Fake Permissions Granted**\n\nRole: ${role?.toString() ?? roleId}\nAdded: ${formatPermissionList(added)}\nNow: ${formatPermissionList(merged)}`;
  }

  private async removePermissions(guild: Guild, roleId: string, permsRaw: string): Promise<string> {
    const { valid, invalid } = parsePermissionTokens([permsRaw]);
    if (invalid.length > 0) {
      return `${getEmoji('danger')} Invalid permissions: ${invalid.map((perm) => `\`${perm}\``).join(', ')}`;
    }
    const config = await this.container.config.fetch(guild.id);
    const fakePermissions: Record<string, string[]> = { ...(config.fakePermissions ?? {}) };
    const existing = normalizeStoredPermissions(fakePermissions[roleId] ?? []);
    if (existing.length === 0) {
      return `${getEmoji('info')} That role has no fake permissions.`;
    }
    const toRemoveSet = new Set(valid);
    const remaining = existing.filter((perm) => !toRemoveSet.has(perm));
    const removed = existing.filter((perm) => toRemoveSet.has(perm));
    if (removed.length === 0) {
      return `${getEmoji('info')} None of those perms were set — current: ${formatPermissionList(existing)}`;
    }
    if (remaining.length === 0) {
      delete fakePermissions[roleId];
    } else {
      fakePermissions[roleId] = remaining;
    }
    await this.container.config.set(guild.id, { fakePermissions });
    const role = await guild.roles.fetch(roleId).catch(() => null);
    await this.container.logging.sendAuditLog(
      guild,
      `${getEmoji('reactionRemove')} Fake perms removed from ${role?.toString() ?? roleId}: ${removed.join(', ')}`
    );
    return `${getEmoji('target')} **Fake Permissions Revoked**\n\nRole: ${role?.toString() ?? roleId}\nRemoved: ${formatPermissionList(removed)}\nNow: ${formatPermissionList(remaining)}`;
  }

  private async listPermissions(guild: Guild, roleId: string | null): Promise<string> {
    const config = await this.container.config.fetch(guild.id);
    const fakePermissions: Record<string, string[]> = config.fakePermissions ?? {};
    if (roleId) {
      const perms = normalizeStoredPermissions(fakePermissions[roleId] ?? []);
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (perms.length === 0) return `${getEmoji('info')} ${role?.toString() ?? roleId} has no fake permissions.`;
      return `${getEmoji('target')} **Fake Permissions — ${role?.name ?? roleId}**\n\n${formatPermissionList(perms)}`;
    }
    const entries = Object.entries(fakePermissions).filter(([, perms]) => perms.length > 0);
    if (entries.length === 0) {
      return `${getEmoji('info')} No fake permissions configured.\n-# Use \`/givepermission add @role <perms>\` or \`!gp @role <perms>\``;
    }
    const lines: string[] = [];
    for (const [rid, perms] of entries.slice(0, 20)) {
      const role = guild.roles.cache.get(rid) ?? (await guild.roles.fetch(rid).catch(() => null));
      const label = role?.toString() ?? `\`${rid}\``;
      lines.push(`${label}: ${formatPermissionList(normalizeStoredPermissions(perms))}`);
    }
    const more = entries.length - lines.length;
    const suffix = more > 0 ? `\n-# +${more} more` : '';
    return `${getEmoji('target')} **Fake Permissions — ${entries.length} roles**\n\n${lines.join('\n')}${suffix}`;
  }

  private async clearPermissions(guild: Guild, roleId: string): Promise<string> {
    const config = await this.container.config.fetch(guild.id);
    const fakePermissions: Record<string, string[]> = { ...(config.fakePermissions ?? {}) };
    if (!fakePermissions[roleId] || fakePermissions[roleId]?.length === 0) {
      return `${getEmoji('info')} That role has no fake permissions to clear.`;
    }
    delete fakePermissions[roleId];
    await this.container.config.set(guild.id, { fakePermissions });
    const role = await guild.roles.fetch(roleId).catch(() => null);
    await this.container.logging.sendAuditLog(
      guild,
      `${getEmoji('reactionRemove')} Fake permissions cleared for ${role?.toString() ?? roleId}`
    );
    return `${getEmoji('target')} **Fake Permissions Cleared**\n\nRole: ${role?.toString() ?? roleId}\nMembers lose those fake perms immediately.`;
  }

  private async showMemberPermissions(guild: Guild, member: GuildMember): Promise<string> {
    const config = await this.container.config.fetch(guild.id);
    const fakePermissions: Record<string, string[]> = config.fakePermissions ?? {};
    const memberRoleIds = [...member.roles.cache.keys()];
    const effective = [...getMemberFakePermissions(memberRoleIds, fakePermissions)].sort();
    const tag = member.user.tag;
    if (effective.length === 0) {
      return `${getEmoji('info')} **${tag}** has no effective fake permissions.\n-# Native Discord perms or Bolt keys still apply.`;
    }
    const sourceRoles: string[] = [];
    for (const [roleId, perms] of Object.entries(fakePermissions)) {
      if (!member.roles.cache.has(roleId)) continue;
      const normalized = normalizeStoredPermissions(perms);
      const hit = normalized.filter((perm) => effective.includes(perm));
      if (hit.length === 0) continue;
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      sourceRoles.push(`${role?.toString() ?? roleId}: ${formatPermissionList(hit)}`);
      if (sourceRoles.length >= 6) break;
    }
    return `${getEmoji('target')} **Fake Permissions — ${tag}**\n\nEffective: ${formatPermissionList(effective)}\n\n${sourceRoles.join('\n')}`;
  }

  private buildGuideDescription(prefix: string): string {
    const choices = FAKE_PERMISSION_CHOICES.map(
      (choice) => `\`${choice}\` — ${FAKE_PERMISSION_DESCRIPTIONS[choice] ?? choice}`
    ).join('\n');
    const presets = Object.entries(FAKE_PERMISSION_PRESETS)
      .map(([name, perms]) => `\`${name}\` → ${perms.map((perm) => `\`${perm}\``).join(', ')}`)
      .join('\n');
    return `${getEmoji('target')} **Fake Permissions — Setup Guide**\n\n**1. Create empty Discord roles** (0 perms ticked) e.g. \`Trial Mod\`, \`Chat Mod\`.\n\n**2. Grant granular perms** — no Discord perms needed on the role:\n\`${prefix}gp @Trial kick timeout warn purge\` or \`${prefix}gp add @Trial mute jail\`\n\`/givepermission add role:@Trial permissions: kick timeout warn\`\n-# Shorthand: \`${prefix}gp @Role ban, kick\` (add) — repeat to extend.\n\n**3. Presets** (bundles):\n${presets}\n-# Use \`${prefix}gp @Role chatmod\` or \`${prefix}gp @Role all\`.\n\n**4. Manage**:\n\`${prefix}gp remove @Trial kick\` — revoke\n\`${prefix}gp list @Trial\` — view role\n\`${prefix}gp list\` — view all\n\`${prefix}gp clear @Trial\` — wipe\n\`${prefix}gp show @User\` — effective perms\n\`/permissions @User\` — full Key I / Key II panel\n\n**Choices:**\n${choices}\n\n-# Admin via \`${prefix}fadmin\` or fake \`admin\`. Fake \`admin\` (Administrator) is **owner only**: \`${prefix}gp @Role admin\`. Fake admins can grant/revoke mods; only owner can grant/revoke fake admins.`;
  }

  private isOwner(guild: Guild, member: GuildMember | null): boolean {
    return member !== null && guild.ownerId === member.id;
  }

  private containsAdminPerm(permsRaw: string): boolean {
    const { valid } = parsePermissionTokens([permsRaw]);
    return valid.includes('Administrator');
  }

  private async roleHasFakeAdmin(guildId: string, roleId: string): Promise<boolean> {
    try {
      const config = await this.container.config.fetch(guildId);
      const perms = config.fakePermissions?.[roleId] ?? [];
      return (perms as string[]).includes('Administrator');
    } catch {
      return false;
    }
  }

  private async resolveGuildPrefix(guildId: string | null): Promise<string> {
    try {
      return await (this.container.client as BotClient).getGuildPrefix(guildId);
    } catch {
      return '!';
    }
  }
}
