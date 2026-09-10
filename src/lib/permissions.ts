import { container } from '@sapphire/framework';
import { Message, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, Guild, GuildMember } from 'discord.js';

export const hasAdminAccess = async (guild: Guild, member: GuildMember, userId: string): Promise<boolean> => {
  if (guild.ownerId === userId) return true;
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  try {
    const config = await container.config.fetch(guild.id);
    return config.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
  } catch (error) {
    container.logger.warn({ err: error, guildId: guild.id }, 'Failed to load admin role configuration');
    return false;
  }
};

export const isAdmin = async (interactionOrMessage: ChatInputCommandInteraction | Message): Promise<boolean> => {
  const guild = interactionOrMessage.guild;
  if (!guild) return false;
  const userId =
    interactionOrMessage instanceof Message ? interactionOrMessage.author.id : interactionOrMessage.user.id;

  // Fast path — WHY: cached checks avoid 2 API round-trips before first ack (3s timeout).
  if (guild.ownerId === userId) return true;
  const cachedPerms =
    interactionOrMessage instanceof Message
      ? (interactionOrMessage.member?.permissions ?? null)
      : (interactionOrMessage.memberPermissions ?? null);
  if (cachedPerms?.has(PermissionFlagsBits.Administrator) || cachedPerms?.has(PermissionFlagsBits.ManageGuild))
    return true;

  let member: GuildMember | null = null;
  if (interactionOrMessage instanceof Message) {
    member =
      interactionOrMessage.member ?? (await guild.members.fetch(interactionOrMessage.author.id).catch(() => null));
  } else {
    member = await guild.members.fetch(interactionOrMessage.user.id).catch(() => null);
  }
  if (!member) return false;

  return hasAdminAccess(guild, member, userId);
};
