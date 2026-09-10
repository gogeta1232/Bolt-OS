import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { MessageFlags, type GuildMember, type ModalSubmitInteraction } from 'discord.js';

import type { WarnCommand } from '../../commands/moderation/warn.js';
import { parseDuration } from '../../lib/utils/duration-parser.js';
import { hasModerationPermission } from '../../lib/utils/moderation-permission-checker.js';

const MODAL_PREFIX = 'warn:issue:';
const MAX_REASON_LENGTH = 1_000;

type WarnModalData = {
  guildId: string;
  targetId: string;
  moderatorId: string;
};

@ApplyOptions<InteractionHandler.Options>({
  name: 'warnModal',
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit
})
export class WarnModalHandler extends InteractionHandler {
  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith(MODAL_PREFIX)) return this.none();

    const [guildId, targetId, moderatorId] = interaction.customId.slice(MODAL_PREFIX.length).split(':');
    if (!guildId || !targetId || !moderatorId) return this.none();
    return this.some({ guildId, targetId, moderatorId } satisfies WarnModalData);
  }

  public override async run(
    interaction: ModalSubmitInteraction,
    { guildId, targetId, moderatorId }: WarnModalData
  ): Promise<void> {
    if (interaction.user.id !== moderatorId || interaction.guildId !== guildId) {
      await interaction.reply({
        content: 'This warning form is not valid for your current server or account.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const guild = interaction.guild;
    const moderator = interaction.member as GuildMember | null;
    if (!guild || !moderator || !(await hasModerationPermission(guild, moderator, moderator.id, 'warn'))) {
      await interaction.reply({
        content: 'You no longer have permission to issue warnings.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      await interaction.reply({
        content: `Provide a reason between 1 and ${MAX_REASON_LENGTH.toLocaleString()} characters.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const durationInput = interaction.fields.getTextInputValue('duration').trim();
    const duration = durationInput ? parseDuration(durationInput) : null;
    if (durationInput && !duration) {
      await interaction.reply({
        content: 'Use a duration such as `30 minutes` or `7 days`.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: 'That member is no longer in this server.' });
      return;
    }

    const warnCommand = this.container.stores.get('commands').get('warn') as WarnCommand | undefined;
    if (!warnCommand) {
      await interaction.editReply({ content: 'The warning service is temporarily unavailable.' });
      return;
    }

    await warnCommand.issueWarning(interaction, target, reason, {
      durationMs: duration?.milliseconds ?? null,
      durationLabel: duration?.pretty ?? null
    });
  }
}
