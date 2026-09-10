import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Message } from 'discord.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { buildLoggingDashboard } from '../../lib/setup-views.js';
import { replyToast } from '../../lib/respond.js';
import { isAdmin } from '../../lib/permissions.js';

@ApplyOptions<Command.Options>({
  name: 'setup',
  aliases: ['config', 'configure', 'setlogs', 'logs'],
  description: 'Logging setup wizard: route each log type to a channel.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class SetupCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await replyToast(interaction, 'warning', 'This command can only be used in a server.');
      return;
    }

    // Ack first — WHY: admin + config lookups can exceed Discord's 3s window.
    const acked = await interaction
      .deferReply({ flags: MessageFlags.Ephemeral })
      .then(() => true)
      .catch(() => false);
    if (!acked) return;

    // Inline admin check — WHY: ensureAdmin throws UserError, which can't reply once deferred.
    if (!(await isAdmin(interaction))) {
      await interaction.editReply({ content: 'Administrator permissions required.' }).catch(() => undefined);
      return;
    }

    const config = await this.container.config.fetch(guild.id);
    const container = buildLoggingDashboard(config, guild.name, interaction.user.id);
    await interaction
      .editReply({ components: [container], flags: MessageFlags.IsComponentsV2 } as never)
      .catch(() => undefined);
  }

  public override async messageRun(message: Message) {
    if (!message.inGuild() || !message.guild) return;
    // Inline admin check — WHY: same denial copy as slash path, no throw-reply mismatch.
    if (!(await isAdmin(message))) {
      await replyToast(message, 'warning', 'Administrator permissions required.');
      return;
    }
    const config = await this.container.config.fetch(message.guild.id);
    const container = buildLoggingDashboard(config, message.guild.name, message.author.id);
    await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }
}
