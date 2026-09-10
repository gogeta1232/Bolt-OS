import { Argument } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';

export class MemberResolvedArgument extends Argument<GuildMember> {
  public async run(parameter: string, context: Argument.Context): Promise<Argument.Result<GuildMember>> {
    const guild = context.message.guild;
    if (!guild)
      return this.error({
        parameter,
        identifier: 'Member guild missing',
        message: 'This command can only be used in a server.',
        context
      });

    if (!parameter.trim())
      return this.error({
        parameter,
        identifier: 'Member not found',
        message: 'Provide a member mention, username, or ID.',
        context
      });

    const result = await this.container.memberResolver.resolve(context.message, [parameter]);
    if (result.member) return this.ok(result.member);
    return this.error({
      parameter,
      identifier: 'Member not found',
      message: result.feedback ?? 'Could not find that member. Mention them or use their user ID.',
      context
    });
  }
}

declare module '@sapphire/framework' {
  interface ArgType {
    memberResolved: GuildMember;
  }
}
