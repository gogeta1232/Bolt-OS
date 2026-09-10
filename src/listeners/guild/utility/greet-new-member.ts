import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener, type ListenerOptions } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

@ApplyOptions<ListenerOptions>({
  event: Events.GuildMemberAdd,
  name: 'greetNewMember'
})
export class GreetNewMemberListener extends Listener {
  public async run(member: GuildMember) {
    const guild = member.guild;
    const config = await this.container.config.fetch(guild.id);

    // Check if greet channels are configured
    const greetChannels = config.greetChannels || [];
    if (greetChannels.length === 0) return;

    // Try to send greeting to each configured channel
    for (const channelId of greetChannels) {
      const greetChannel = guild.channels.cache.get(channelId);
      if (!greetChannel || !('send' in greetChannel)) continue;

      try {
        // Use configured template or default message
        const template = config.greetMessage || 'Welcome to the server, {{user}}!';
        const greetingMessage = template.replace('{{user}}', member.toString());
        const sentMessage = await greetChannel.send({
          content: greetingMessage,
          allowedMentions: { parse: [], users: [member.id] }
        });

        const deleteTimer = setTimeout(() => {
          sentMessage.delete().catch(() => {}); // Ignore errors when deleting
        }, 2000);
        deleteTimer.unref();
      } catch (error) {
        // Log the error but continue with other channels
        this.container.logger.error(
          { err: error, guildId: guild.id, userId: member.id, channelId },
          'Failed to greet new member in channel'
        );
        continue;
      }
    }
  }
}
