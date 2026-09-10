import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, type AnySelectMenuInteraction, type GuildMember } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { hasAdminAccess } from '../../lib/permissions.js';
import {
  SETUP_LOG_TYPES,
  buildLoggingDashboard,
  buildRouteChannelPicker,
  formatLogType
} from '../../lib/setup-views.js';

@ApplyOptions<InteractionHandler.Options>({
  // WHY explicit name: see buttons/setup.ts — duplicate "setup" piece name evicted a handler.
  name: 'setupSelect',
  interactionHandlerType: InteractionHandlerTypes.SelectMenu
})
export class SetupSelectHandler extends InteractionHandler {
  public override parse(interaction: AnySelectMenuInteraction) {
    if (!interaction.isAnySelectMenu()) return this.none();
    if (!interaction.customId.startsWith('setup:')) return this.none();
    // setup:route:type:<req> | setup:route:channel:<type>:<req> | setup:clear:type:<req>
    // Legacy (stateless era): setup:logs:type | setup:logs:channel | setup:welcome:ch | setup:jail:role | setup:jail:ch
    return this.some({ customId: interaction.customId, values: interaction.values });
  }

  public override async run(interaction: AnySelectMenuInteraction, parsed: { customId: string; values: string[] }) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction
          .reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      const customId = this.normalizeLegacyId(parsed.customId, interaction.user.id);
      const parts = customId.split(':');
      const requesterId = parts[parts.length - 1] ?? '';
      // WHY reply (not followUp): nothing acked yet — same denial pattern as help handler.
      if (!(await this.canUse(interaction, requesterId))) {
        await interaction
          .reply({
            content: 'Only the setup requester or a server manager can use these.',
            flags: MessageFlags.Ephemeral
          })
          .catch(() => undefined);
        return;
      }

      const kind = `${parts[1] ?? ''}:${parts[2] ?? ''}`;

      if (kind === 'route:type') {
        const type = parsed.values[0] ?? '';
        if (type !== 'all' && !(SETUP_LOG_TYPES as readonly string[]).includes(type)) {
          await interaction
            .reply({ content: 'Pick a valid log type.', flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
          return;
        }
        // WHY update (not defer+edit): single roundtrip, same as help/snipe handlers.
        await interaction
          .update({
            components: [buildRouteChannelPicker(type, requesterId)],
            flags: MessageFlags.IsComponentsV2
          } as never)
          .catch(() => undefined);
        return;
      }

      if (kind === 'route:channel') {
        // setup:route:channel:<type>:<req>
        const type = parts[3] ?? 'all';
        const channelId = parsed.values[0] ?? '';
        if (!channelId) {
          await interaction.reply({ content: 'Pick a channel.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
          return;
        }
        const config = await this.container.config.fetch(guild.id);
        const logChannels = { ...(config.logChannels ?? {}) };
        const targets = type === 'all' ? [...SETUP_LOG_TYPES] : [type];
        for (const target of targets) logChannels[target as keyof typeof logChannels] = channelId;
        try {
          await this.container.config.set(guild.id, { logChannels });
        } catch {
          // WHY visible error: set() throws on DB failure — silent catch left the menu spinning.
          await interaction
            .reply({
              content: 'Could not save that route — database unavailable. Try again.',
              flags: MessageFlags.Ephemeral
            })
            .catch(() => undefined);
          return;
        }
        // WHY: reuse local state instead of re-fetching — halves DB roundtrips.
        const updated = { ...config, logChannels };
        await interaction
          .update({
            components: [buildLoggingDashboard(updated, guild.name, requesterId)],
            flags: MessageFlags.IsComponentsV2
          } as never)
          .catch(() => undefined);
        const label = type === 'all' ? 'All logs' : formatLogType(type);
        await interaction
          .followUp({
            content: `${getEmoji('success')} ${label} → <#${channelId}>`,
            flags: MessageFlags.Ephemeral
          } as never)
          .catch(() => undefined);
        // WHY: fire-and-forget — audit write must never delay the wizard reply.
        void this.container.logging
          .sendAuditLog(guild, `${getEmoji('log')} Logging → ${targets.join(', ')} → <#${channelId}>`)
          .catch(() => undefined);
        return;
      }

      if (kind === 'clear:type') {
        const type = parsed.values[0] ?? '';
        if (type !== 'all' && !(SETUP_LOG_TYPES as readonly string[]).includes(type)) {
          await interaction
            .reply({ content: 'Pick a valid log type.', flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
          return;
        }
        const config = await this.container.config.fetch(guild.id);
        const logChannels = { ...(config.logChannels ?? {}) };
        const targets = type === 'all' ? [...SETUP_LOG_TYPES] : [type];
        for (const target of targets) delete logChannels[target as keyof typeof logChannels];
        try {
          await this.container.config.set(guild.id, { logChannels });
        } catch {
          await interaction
            .reply({
              content: 'Could not clear that route — database unavailable. Try again.',
              flags: MessageFlags.Ephemeral
            })
            .catch(() => undefined);
          return;
        }
        // WHY: reuse local state instead of re-fetching — halves DB roundtrips.
        const updated = { ...config, logChannels };
        await interaction
          .update({
            components: [buildLoggingDashboard(updated, guild.name, requesterId)],
            flags: MessageFlags.IsComponentsV2
          } as never)
          .catch(() => undefined);
        const label = type === 'all' ? 'All logging disabled' : `${formatLogType(type)} logging disabled`;
        await interaction
          .followUp({ content: `${getEmoji('success')} ${label}.`, flags: MessageFlags.Ephemeral } as never)
          .catch(() => undefined);
        return;
      }

      // WHY visible fallback: unknown/stale menu ids previously fell through silently and spun forever.
      await interaction
        .reply({
          content: 'That menu is outdated — run `setup` again for a fresh panel.',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.warn({ err: error, customId: interaction.customId }, 'Setup select handler failed');
      // WHY visible fallback: silent catch = "application didn't respond" from the user's side.
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction
            .followUp({
              content: 'Something went wrong updating setup. Run `setup` again.',
              flags: MessageFlags.Ephemeral
            })
            .catch(() => undefined);
        } else {
          await interaction
            .reply({
              content: 'Something went wrong updating setup. Run `setup` again.',
              flags: MessageFlags.Ephemeral
            })
            .catch(() => undefined);
        }
      } catch {
        // Last resort — nothing left to try.
      }
    }
  }

  /**
   * Rewrites pre logging-only-wizard ids to the current protocol.
   * WHY: stale dashboards would otherwise hit "This interaction failed".
   */
  private normalizeLegacyId(customId: string, userId: string): string {
    if (customId === 'setup:logs:type') return `setup:route:type:${userId}`;
    if (customId === 'setup:logs:channel') return `setup:route:channel:all:${userId}`;
    if (customId === 'setup:welcome:ch' || customId === 'setup:jail:role' || customId === 'setup:jail:ch') {
      return `setup:route:type:${userId}`;
    }
    return customId;
  }

  private async canUse(interaction: AnySelectMenuInteraction, requesterId: string): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) return false;
    const member = interaction.member as GuildMember | null;
    if (!member) return false;

    const hasPermission = await hasAdminAccess(guild, member, interaction.user.id);
    return (
      hasPermission && (interaction.user.id === requesterId || member.permissions.has(PermissionFlagsBits.ManageGuild))
    );
  }
}
