import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, type AnySelectMenuInteraction } from 'discord.js';

import { HELP_COMPONENTS_FLAGS, buildHelpCatalog, buildHelpPanel } from '../../lib/help-views.js';

@ApplyOptions<InteractionHandler.Options>({
  // WHY explicit name: piece names default to filename; duplicates evict silently.
  // WHY separate handler: Sapphire routes selects only to SelectMenu handlers —
  // the old button-typed handler parsed selects but never received them.
  name: 'helpSelect',
  interactionHandlerType: InteractionHandlerTypes.SelectMenu
})
export class HelpSelectHandler extends InteractionHandler {
  public override parse(interaction: AnySelectMenuInteraction) {
    if (!interaction.isAnySelectMenu()) return this.none();
    if (!interaction.customId.startsWith('help:')) return this.none();
    // help:select:<req> — values[0] is the module id.
    return this.some({ customId: interaction.customId, values: interaction.values });
  }

  public override async run(interaction: AnySelectMenuInteraction, parsed: { customId: string; values: string[] }) {
    try {
      const parts = parsed.customId.split(':');
      const requesterId = parts[parts.length - 1] ?? '';
      if (interaction.user.id !== requesterId) {
        await interaction
          .reply({ content: 'Only the requester can use these controls.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }
      const moduleId = parsed.values[0] ?? '';
      if (!moduleId) {
        await interaction
          .reply({ content: 'Pick a module first.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
        return;
      }
      const prefix = await this.resolveGuildPrefix(interaction.guildId ?? null);
      const modules = buildHelpCatalog(this.container.stores.get('commands').values());
      await interaction
        .update({
          components: [buildHelpPanel(modules, moduleId, 0, prefix, requesterId)],
          flags: HELP_COMPONENTS_FLAGS
        } as never)
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.debug({ err: error, customId: interaction.customId }, 'Help select handler failed');
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
