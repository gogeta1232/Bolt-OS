import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener, type ListenerOptions } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

@ApplyOptions<ListenerOptions>({
  event: Events.GuildMemberAdd,
  name: 'greetNewMember'
})
export class GreetNewMemberListener extends Listener {
  public async run(member: GuildMember): Promise<void> {
    await this.container.greetings.greet({ guildId: member.guild.id, userId: member.id, mention: member.toString() });
  }
}
