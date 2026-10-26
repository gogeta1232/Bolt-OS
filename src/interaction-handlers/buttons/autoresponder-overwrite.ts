import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { hasAdminAccess } from '../../lib/permissions.js';

export class AutoResponderOverwriteHandler extends InteractionHandler {
  public constructor(context: InteractionHandler.Context, options: InteractionHandler.Options) {
    super(context, {
      ...options,
      name: 'autoresponderOverwrite',
      interactionHandlerType: InteractionHandlerTypes.Button
    });
  }

  public override parse(interaction: ButtonInteraction) {
    const match = /^autoresponder:(overwrite|cancel):([a-f0-9-]{36})$/.exec(interaction.customId);
    const action = match?.[1];
    const token = match?.[2];
    if (!token || (action !== 'overwrite' && action !== 'cancel')) return this.none();
    return this.some({ token, overwrite: action === 'overwrite' });
  }

  public override async run(
    interaction: ButtonInteraction,
    parsed: { token: string; overwrite: boolean }
  ): Promise<void> {
    const pending = this.container.autoResponders.getOverwrite(parsed.token);
    if (!pending) {
      await interaction.update({
        embeds: [
          createEmbed({
            description: 'This confirmation expired or was already handled. Run the add command again.',
            type: 'warning'
          })
        ],
        components: [],
        allowedMentions: { parse: [] }
      });
      return;
    }
    if (interaction.user.id !== pending.proposed.createdBy || interaction.guildId !== pending.proposed.guildId) {
      await interaction.reply({
        content: 'Only the admin who requested this change can confirm it.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      const guild = interaction.guild;
      const member = await guild?.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
      if (!guild || !member || !(await hasAdminAccess(guild, member, interaction.user.id))) {
        await interaction.followUp({
          content: 'You no longer have administrator access. The responder was kept.',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] }
        });
        return;
      }
      const result = await this.container.autoResponders.resolveOverwrite(
        parsed.token,
        guild.id,
        interaction.user.id,
        parsed.overwrite
      );
      const description =
        result === 'updated'
          ? `Responder updated for "${pending.proposed.trigger}".`
          : result === 'cancelled'
            ? 'Overwrite cancelled. The existing responder was kept.'
            : 'The responder changed or this confirmation expired. Run the add command again.';
      await interaction.editReply({
        embeds: [createEmbed({ description, type: result === 'updated' ? 'success' : 'warning' })],
        components: [],
        allowedMentions: { parse: [] }
      });
      if (result === 'updated') {
        await this.container.logging
          .sendAuditLog(guild, `Auto responder updated: ${pending.proposed.trigger}`)
          .catch((error: unknown) => {
            this.container.logger.error({ err: error, guildId: guild.id }, 'Failed to log autoresponder overwrite');
          });
      }
    } catch (error) {
      this.container.logger.error({ err: error, guildId: interaction.guildId }, 'Autoresponder confirmation failed');
      await interaction.editReply({
        embeds: [
          createEmbed({
            description: 'Could not complete the overwrite. Check the responder list before trying again.',
            type: 'danger'
          })
        ],
        components: [],
        allowedMentions: { parse: [] }
      });
    }
  }
}
