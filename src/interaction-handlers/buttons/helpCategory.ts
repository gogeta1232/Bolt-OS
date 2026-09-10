import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

import {
  HELP_COMPONENTS_FLAGS,
  buildHelpCatalog,
  buildHelpClosed,
  buildHelpHome,
  buildHelpPanel
} from '../../lib/help-views.js';

type HelpButtonAction = 'prev' | 'next' | 'close' | 'category' | 'home';

/** Legacy ids (help:close:<req>) carry no module/page — fall back to first module. */
const LEGACY_CLOSE = 'close';

@ApplyOptions<InteractionHandler.Options>({
  // WHY explicit name: piece names default to filename; duplicates evict silently.
  name: 'helpButtons',
  interactionHandlerType: InteractionHandlerTypes.Button
})
export class HelpCategoryHandler extends InteractionHandler {
  public override parse(interaction: ButtonInteraction) {
    if (!interaction.isButton()) return this.none();
    if (!interaction.customId.startsWith('help:')) return this.none();
    const parts = interaction.customId.split(':');
    const action = parts[1] ?? '';
    if (!['prev', 'next', 'close', 'category', 'home'].includes(action)) return this.none();
    if (action === 'home') {
      const requesterId = parts[2] ?? '';
      if (!requesterId) return this.none();
      return this.some({ action, moduleId: '', page: 0, requesterId });
    }
    if (action === 'close' && parts.length === 3) {
      return this.some({ action: LEGACY_CLOSE, moduleId: '', page: 0, requesterId: parts[2] ?? '' });
    }
    if (action === 'category') {
      const moduleId = parts[2] ?? '';
      const requesterId = parts[3] ?? '';
      if (!moduleId || !requesterId) return this.none();
      return this.some({ action, moduleId, page: 0, requesterId });
    }
    const moduleId = parts[2] ?? '';
    const page = Number(parts[3] ?? 0);
    const requesterId = parts[4] ?? '';
    if (!moduleId || Number.isNaN(page) || !requesterId) return this.none();
    return this.some({ action: action as HelpButtonAction, moduleId, page, requesterId });
  }

  public override async run(
    interaction: ButtonInteraction,
    parsed: { action: HelpButtonAction | 'close'; moduleId: string; page: number; requesterId: string }
  ) {
    try {
      if (interaction.user.id !== parsed.requesterId) {
        await interaction
          .reply({ content: 'Only the requester can use these controls.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }
      if (parsed.action === 'close') {
        await interaction
          .update({ components: [buildHelpClosed()], flags: HELP_COMPONENTS_FLAGS } as never)
          .catch(() => undefined);
        return;
      }
      const prefix = await this.resolveGuildPrefix(interaction.guildId ?? null);
      const modules = buildHelpCatalog(this.container.stores.get('commands').values());
      if (parsed.action === 'home') {
        await interaction
          .update({
            components: [buildHelpHome(modules, prefix, parsed.requesterId)],
            flags: HELP_COMPONENTS_FLAGS
          } as never)
          .catch(() => undefined);
        return;
      }
      const first = modules[0]?.id ?? 'utility';
      const moduleId = parsed.action === 'category' ? parsed.moduleId : parsed.moduleId || first;
      const page =
        parsed.action === 'category'
          ? 0
          : parsed.page + (parsed.action === 'next' ? 1 : parsed.action === 'prev' ? -1 : 0);
      // WHY update (not defer+edit): single roundtrip, same as setup/snipe handlers.
      await interaction
        .update({
          components: [buildHelpPanel(modules, moduleId, page, prefix, parsed.requesterId)],
          flags: HELP_COMPONENTS_FLAGS
        } as never)
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.debug({ err: error, customId: interaction.customId }, 'Help buttons handler failed');
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction
            .followUp({ content: 'Failed to update help.', flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        } else {
          await interaction
            .reply({ content: 'Failed to update help.', flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        }
      } catch {
        // Last resort — nothing left to try.
      }
    }
  }

  private async resolveGuildPrefix(guildId: string | null): Promise<string> {
    try {
      const client = this.container.client as import('../../lib/bot-client.js').BotClient;
      return await client.getGuildPrefix(guildId);
    } catch {
      return '!';
    }
  }
}
