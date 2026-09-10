import { ApplyOptions } from '@sapphire/decorators';
import { Command, RegisterBehavior } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, Message } from 'discord.js';

import { theme } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';

@ApplyOptions<Command.Options>({
  name: 'ping',
  description: 'Check bot latency',
  enabled: true,
  requiredClientPermissions: ['SendMessages'],
  runIn: ['GUILD_ANY']
})
export class PingCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description), {
      behaviorWhenNotIdentical: RegisterBehavior.Overwrite
    });
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const start = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ping = this.buildResponse(Date.now() - start);
    await interaction.editReply({ embeds: [ping] });
  }

  public override async messageRun(message: Message) {
    const start = Date.now();
    const reply = await message.reply({
      content: `${getEmoji('ping')} Pinging...`
    });
    const embed = this.buildResponse(Date.now() - start);
    await reply.edit({ content: '', embeds: [embed] });
  }

  /**
   * Builds pong embed with WebSocket and REST latency.
   * @param restLatencyMs - Round-trip REST latency in milliseconds
   * @returns Embed ready to send
   */
  private buildResponse(restLatencyMs: number): EmbedBuilder {
    const webSocketLatencyMs = Math.round(this.container.client.ws.ping);
    return new EmbedBuilder()
      .setColor(theme.colors.primary)
      .setDescription(
        `${getEmoji('ping')} **Pong!** WebSocket: \`${webSocketLatencyMs}ms\` • API: \`${restLatencyMs}ms\``
      );
  }
}
