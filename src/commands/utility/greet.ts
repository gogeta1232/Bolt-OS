import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, User, TextChannel, Guild } from 'discord.js';

import { single } from '../../lib/embeds.js';

const GREET_MESSAGE_DELETE_DELAY_MS = 2000;
const USER_ID_PATTERN = /^\d{17,19}$/;
const TOKEN_SPLIT_PATTERN = /\s+/;
const DEFAULT_GREET_TEMPLATE = 'Welcome to the server, {{user}}!';
const GREET_PLACEHOLDER = '{{user}}';
const NO_GREET_CHANNELS_MESSAGE =
  'No greet channels configured for this guild. An admin needs to set them using `/setgreetchannel add #channel`.';
const GREET_USAGE_MESSAGE = 'Usage: `!greet <@member> [message]`';
const GREET_MISSING_TARGET_MESSAGE = 'Please mention a user to greet.';

interface GreetGuildConfig {
  greetChannels?: string[];
  greetMessage?: string;
}

interface GreetTargetResolution {
  targetUser: User | null;
  customMessage: string;
}

interface GreetSendResult {
  didSend: boolean;
  lastErrorMessage: string;
}

@ApplyOptions<Command.Options>({
  name: 'greet',
  description: 'Ping a member in the greet channel to welcome them.',
  requiredClientPermissions: [PermissionFlagsBits.SendMessages],
  enabled: true,
  runIn: ['GUILD_ANY']
})
export class GreetCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addUserOption((option) => option.setName('member').setDescription('Member to greet').setRequired(true))
          .addStringOption((option) =>
            option.setName('message').setDescription('Custom greeting message').setMaxLength(2_000)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const targetMember = interaction.options.getUser('member', true);
      const customMessage = interaction.options.getString('message') ?? '';

      const guildConfig = await this.fetchGreetConfig(interaction.guildId!);
      const greetChannelIds = guildConfig.greetChannels ?? [];

      if (greetChannelIds.length === 0) {
        await interaction.reply(single(NO_GREET_CHANNELS_MESSAGE, 'warning', true) as never);
        return;
      }

      const sendResult = await this.sendGreetingToChannels({
        guild: interaction.guild!,
        channelIds: [...greetChannelIds],
        targetUser: targetMember,
        customMessage,
        configTemplate: guildConfig.greetMessage ?? DEFAULT_GREET_TEMPLATE
      });

      if (sendResult.didSend) {
        const firstChannelId = greetChannelIds[0];
        const channelMention = `<#${firstChannelId}>`;
        await interaction.reply(
          single(`Greeted ${targetMember.toString()} in ${channelMention}`, 'success', true) as never
        );
        return;
      }

      await interaction.reply(
        single(
          `Failed to greet ${targetMember.tag} in any configured channel: ${sendResult.lastErrorMessage}`,
          'danger',
          true
        ) as never
      );
    } catch (commandError) {
      this.container.logger.error({ err: commandError, guildId: interaction.guildId }, 'Greet chatInputRun failed');
      const errorPayload = single('Failed to execute greet command due to an internal error.', 'danger', true) as never;
      if (interaction.replied || interaction.deferred) await interaction.followUp(errorPayload).catch(() => {});
      else await interaction.reply(errorPayload).catch(() => {});
    }
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    try {
      const channel = message.channel;
      if (!channel || !('send' in channel)) return;
      if (!message.guild) return;

      const guildConfig = await this.fetchGreetConfig(message.guild.id);
      const greetChannelIds = guildConfig.greetChannels ?? [];

      if (greetChannelIds.length === 0) {
        await channel.send(single(NO_GREET_CHANNELS_MESSAGE, 'warning') as never);
        return;
      }

      const targetResolution = await this.resolveGreetTarget(message, args);
      if (!targetResolution.targetUser) {
        await channel.send(single(targetResolution.customMessage || GREET_MISSING_TARGET_MESSAGE, 'warning') as never);
        return;
      }

      const sendResult = await this.sendGreetingToChannels({
        guild: message.guild,
        channelIds: [...greetChannelIds],
        targetUser: targetResolution.targetUser,
        customMessage: targetResolution.customMessage,
        configTemplate: guildConfig.greetMessage ?? DEFAULT_GREET_TEMPLATE
      });

      if (sendResult.didSend) {
        const firstChannelMention = `<#${greetChannelIds[0]}>`;
        await channel.send(
          single(`Greeted ${targetResolution.targetUser.toString()} in ${firstChannelMention}`, 'success') as never
        );
        return;
      }

      await channel.send(
        single(
          `Failed to greet ${targetResolution.targetUser.tag} in any configured channel: ${sendResult.lastErrorMessage}`,
          'danger'
        ) as never
      );
    } catch (commandError) {
      this.container.logger.error({ err: commandError, guildId: message.guild?.id }, 'Greet messageRun failed');
    }
  }

  private async fetchGreetConfig(guildId: string): Promise<GreetGuildConfig> {
    try {
      const guildConfig = await this.container.config.fetch(guildId);
      return { ...guildConfig } as GreetGuildConfig;
    } catch (fetchError) {
      this.container.logger.error({ err: fetchError, guildId }, 'Failed to fetch greet config');
      return { greetChannels: [], greetMessage: DEFAULT_GREET_TEMPLATE };
    }
  }

  private async sendGreetingToChannels(options: {
    guild: Guild;
    channelIds: string[];
    targetUser: User;
    customMessage: string;
    configTemplate: string;
  }): Promise<GreetSendResult> {
    let lastErrorMessage = '';
    let didSendAny = false;

    const greetingContent = this.buildGreetingContent(
      options.customMessage,
      options.configTemplate,
      options.targetUser
    );

    const sendPromises = options.channelIds.map(async (channelId) => {
      const greetChannel = options.guild.channels.cache.get(channelId);
      if (!greetChannel || !('send' in greetChannel)) return null;
      try {
        const sentMessage = await (greetChannel as TextChannel).send({
          content: greetingContent,
          allowedMentions: { parse: [], users: [options.targetUser.id] }
        });
        const deleteTimer = setTimeout(() => {
          sentMessage.delete().catch(() => {});
        }, GREET_MESSAGE_DELETE_DELAY_MS);
        deleteTimer.unref();
        return channelId;
      } catch (channelError) {
        lastErrorMessage = (channelError as Error).message;
        return null;
      }
    });

    const sendResults = await Promise.all(sendPromises);
    didSendAny = sendResults.some((result) => result !== null);

    return { didSend: didSendAny, lastErrorMessage };
  }

  private buildGreetingContent(customMessage: string, template: string, targetUser: User): string {
    if (customMessage?.trim()) return customMessage.trim();
    const templateMessage = template || DEFAULT_GREET_TEMPLATE;
    return templateMessage.replace(GREET_PLACEHOLDER, targetUser.toString());
  }

  private async resolveGreetTarget(message: Message, args: Args): Promise<GreetTargetResolution> {
    const fromSapphireArgs = await this.resolveTargetFromSapphireArgs(args);
    if (fromSapphireArgs.targetUser) return fromSapphireArgs;

    const fromMentions = await this.resolveTargetFromMentions(message, args);
    if (fromMentions.targetUser) return fromMentions;

    return { targetUser: null, customMessage: GREET_USAGE_MESSAGE };
  }

  private async resolveTargetFromSapphireArgs(args: Args): Promise<GreetTargetResolution> {
    try {
      const memberResolvedPeek = await args.peekResult('memberResolved');
      if (memberResolvedPeek.isOk()) {
        const resolvedMember = await args.pick('memberResolved').catch(() => null);
        if (resolvedMember) {
          const remainingMessage = (await args.rest('string').catch(() => ''))?.trim() ?? '';
          return { targetUser: resolvedMember.user, customMessage: remainingMessage };
        }
      }

      const userPeek = await args.peekResult('user');
      if (userPeek.isOk()) {
        const resolvedUser = await args.pick('user').catch(() => null);
        if (resolvedUser) {
          const remainingMessage = (await args.rest('string').catch(() => ''))?.trim() ?? '';
          return { targetUser: resolvedUser, customMessage: remainingMessage };
        }
      }
    } catch {
      return { targetUser: null, customMessage: '' };
    }
    return { targetUser: null, customMessage: '' };
  }

  private async resolveTargetFromMentions(message: Message, args: Args): Promise<GreetTargetResolution> {
    if (args.finished) return this.resolveTargetWhenArgsFinished(message, args);

    // Sapphire Args: use rest string tokens instead of manual message.content split
    const remainder = await args.rest('string').catch(() => '');
    const contentTokens = remainder?.trim() ? remainder.trim().split(TOKEN_SPLIT_PATTERN).filter(Boolean) : [];
    // if remainder consumed already via peek earlier, contentTokens may be empty; fallback to mentions/ID detection via leftover
    if (contentTokens.length === 0) {
      const mention = message.mentions.users.first();
      if (mention) return { targetUser: mention, customMessage: '' };
      return { targetUser: null, customMessage: GREET_USAGE_MESSAGE };
    }

    const mentionedUser = message.mentions.users.first() ?? null;
    if (mentionedUser) return this.resolveTargetFromMentionToken(mentionedUser, contentTokens, args);

    const firstToken = contentTokens[0];
    if (firstToken && USER_ID_PATTERN.test(firstToken)) return this.resolveTargetFromUserIdToken(contentTokens, args);

    // For username case, we need to push tokens back to args via synthetic handling
    // Instead delegate to username resolver which will use args.rest again (already consumed)
    // Use remainder directly
    const nameTokens = contentTokens;
    const resolution = await this.container.memberResolver.resolve(message, [...nameTokens]);
    if (resolution.member) return { targetUser: resolution.member.user, customMessage: '' };
    return { targetUser: null, customMessage: '' };
  }

  private async resolveTargetWhenArgsFinished(message: Message, args: Args): Promise<GreetTargetResolution> {
    const mentionUser = message.mentions.users.first() ?? null;
    if (mentionUser) {
      const remainder = await args.rest('string').catch(() => null);
      if (remainder?.trim()) return { targetUser: mentionUser, customMessage: remainder.trim() };
      return { targetUser: mentionUser, customMessage: '' };
    }

    return { targetUser: null, customMessage: GREET_USAGE_MESSAGE };
  }

  private async resolveTargetFromMentionToken(
    mentionedUser: User,
    contentTokens: string[],
    args: Args
  ): Promise<GreetTargetResolution> {
    const mentionIndex = contentTokens.findIndex((token) => token.includes(mentionedUser.id));
    const trailingMessage = mentionIndex !== -1 ? contentTokens.slice(mentionIndex + 1).join(' ') : '';
    await args.rest('string').catch(() => null);
    return { targetUser: mentionedUser, customMessage: trailingMessage };
  }

  private async resolveTargetFromUserIdToken(contentTokens: string[], args: Args): Promise<GreetTargetResolution> {
    const userId = contentTokens[0];
    if (!userId) return { targetUser: null, customMessage: '' };
    const fetchedUser = await this.container.client.users.fetch(userId).catch(() => null);
    if (!fetchedUser) return { targetUser: null, customMessage: '' };
    const trailingMessage = contentTokens.slice(1).join(' ');
    await args.rest('string').catch(() => null);
    return { targetUser: fetchedUser, customMessage: trailingMessage };
  }
}
