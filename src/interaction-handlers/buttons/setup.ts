import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type GuildMember
} from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { hasAdminAccess } from '../../lib/permissions.js';
import {
  SETUP_ACCENT,
  buildClearPanel,
  buildLoggingDashboard,
  buildRoutePanel,
  patchContainer
} from '../../lib/setup-views.js';

type SetupAction = 'home' | 'route' | 'clear' | 'close';

/** Maps stale dashboard buttons (pre logging-only wizard) to current actions. */
const LEGACY_ACTIONS: Record<string, SetupAction> = {
  logs: 'route',
  prefix: 'home',
  welcome: 'home',
  greet: 'home',
  jail: 'home'
};

@ApplyOptions<InteractionHandler.Options>({
  // WHY explicit name: piece names default to the filename — buttons/setup.ts and
  // select-menus/setup.ts both defaulted to "setup" and the second load silently
  // unloaded the first (Store.insert evicts on name conflict), killing all buttons.
  name: 'setupButton',
  interactionHandlerType: InteractionHandlerTypes.Button
})
export class SetupButtonHandler extends InteractionHandler {
  public override parse(interaction: ButtonInteraction) {
    if (!interaction.isButton()) return this.none();
    if (!interaction.customId.startsWith('setup:')) return this.none();
    const parts = interaction.customId.split(':');
    const rawAction = parts[1] ?? '';
    // Legacy 2-part ids (setup:close) carry no requester — fall back to clicker.
    const requesterId = parts[2] ?? interaction.user.id;
    const action = (['home', 'route', 'clear', 'close'] as string[]).includes(rawAction)
      ? (rawAction as SetupAction)
      : LEGACY_ACTIONS[rawAction];
    if (!action) return this.none();
    return this.some({ action, requesterId });
  }

  public override async run(interaction: ButtonInteraction, parsed: { action: SetupAction; requesterId: string }) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction
          .reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }

      // WHY reply (not followUp): nothing acked yet — same denial pattern as help handler.
      if (!(await this.canUse(interaction, parsed.requesterId))) {
        await interaction
          .reply({
            content: 'Only the setup requester or a server manager can use these.',
            flags: MessageFlags.Ephemeral
          })
          .catch(() => undefined);
        return;
      }

      const { action, requesterId } = parsed;

      if (action === 'close') {
        await interaction
          .update({ components: [this.buildClosed()], flags: MessageFlags.IsComponentsV2 } as never)
          .catch(() => undefined);
        return;
      }

      const config = await this.container.config.fetch(guild.id);
      const container =
        action === 'home'
          ? buildLoggingDashboard(config, guild.name, requesterId)
          : action === 'route'
            ? buildRoutePanel(config, requesterId)
            : buildClearPanel(config, requesterId);
      // WHY update (not defer+edit): single roundtrip, same as help/snipe handlers — faster and no deferred-hang window.
      await interaction
        .update({ components: [container], flags: MessageFlags.IsComponentsV2 } as never)
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.warn({ err: error, customId: interaction.customId }, 'Setup button handler failed');
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

  private async canUse(interaction: ButtonInteraction, requesterId: string): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) return false;
    const member = interaction.member as GuildMember | null;
    if (!member) return false;

    const hasPermission = await hasAdminAccess(guild, member, interaction.user.id);
    return (
      hasPermission && (interaction.user.id === requesterId || member.permissions.has(PermissionFlagsBits.ManageGuild))
    );
  }

  private buildClosed() {
    const container = new ContainerBuilder().setAccentColor(SETUP_ACCENT);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${getEmoji('log')} Logging setup\n-# Closed. Run \`setup\` again to reopen.`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    return patchContainer(container);
  }
}
