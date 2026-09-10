import { Events, Listener } from '@sapphire/framework';
import type {
  ChatInputCommandErrorPayload,
  ChatInputCommandSuccessPayload,
  MessageCommandErrorPayload,
  MessageCommandSuccessPayload
} from '@sapphire/framework';
import type { GuildBasedChannel } from 'discord.js';

import { resolveChannelContext, resolveMessageContext } from '../../config/logging.js';

export class CommandLoggingListener extends Listener {
  private readonly chatInputSuccessHandler = (payload: ChatInputCommandSuccessPayload) => {
    void this.logChatInputCommand(payload);
  };

  private readonly chatInputErrorHandler = (error: unknown, payload: ChatInputCommandErrorPayload) => {
    void this.logChatInputError(error, payload);
  };

  private readonly messageErrorHandler = (error: unknown, payload: MessageCommandErrorPayload) => {
    void this.logMessageError(error, payload);
  };

  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCommandSuccess });
  }

  public override async run(payload: MessageCommandSuccessPayload) {
    await this.logMessageCommand(payload);
  }

  public override onLoad() {
    this.container.client.on(Events.ChatInputCommandSuccess, this.chatInputSuccessHandler);
    this.container.client.on(Events.ChatInputCommandError, this.chatInputErrorHandler);
    this.container.client.on(Events.MessageCommandError, this.messageErrorHandler);
  }

  public override onUnload() {
    this.container.client.off(Events.ChatInputCommandSuccess, this.chatInputSuccessHandler);
    this.container.client.off(Events.ChatInputCommandError, this.chatInputErrorHandler);
    this.container.client.off(Events.MessageCommandError, this.messageErrorHandler);
  }

  private async logMessageCommand({ message, command }: MessageCommandSuccessPayload) {
    // WHY sleek body: who/where/when ride in header pills + footer ID — no raw ids or guild echo.
    // WHY message context: staff audit needs <#channel> + ID + [Jump](https://discord.com/channels/guild/channel/message).
    this.container.logger.info(
      { command: command.name, userId: message.author.id, guildId: message.guild?.id },
      `prefix command used: ${command.name}`
    );
    if (message.guild) {
      await this.container.logging.sendAuditLog(message.guild, `\`!${command.name}\` used`, {
        actor: message.author,
        channel: resolveChannelContext(message.channel as GuildBasedChannel | null),
        message: resolveMessageContext(message),
        timestamp: Date.now(),
        hideDetailsSection: true
      });
    }
  }

  private async logChatInputCommand({ interaction, command }: ChatInputCommandSuccessPayload) {
    this.container.logger.info(
      { command: command.name, userId: interaction.user.id, guildId: interaction.guild?.id },
      `slash command used: ${command.name}`
    );
    if (interaction.guild) {
      // WHY channel-only: slash interactions have no message ID — no Jump link to render.
      await this.container.logging.sendAuditLog(interaction.guild, `\`/${command.name}\` used`, {
        actor: interaction.user,
        channel: interaction.channelId ? { id: interaction.channelId } : null,
        timestamp: Date.now(),
        hideDetailsSection: true
      });
    }
  }

  private async logChatInputError(error: unknown, { interaction, command }: ChatInputCommandErrorPayload) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    this.container.logger.error(
      { err: resolved, command: command?.name, userId: interaction.user.id, guildId: interaction.guild?.id },
      'Chat input command error'
    );
    if (interaction.guild) {
      await this.container.logging.sendAuditLog(
        interaction.guild,
        `\`/${command?.name ?? 'unknown'}\` failed — ${resolved.message}`,
        {
          actor: interaction.user,
          channel: interaction.channelId ? { id: interaction.channelId } : null,
          timestamp: Date.now(),
          hideDetailsSection: true
        }
      );
    }
  }

  private async logMessageError(error: unknown, { message, command }: MessageCommandErrorPayload) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    this.container.logger.error(
      { err: resolved, command: command?.name, userId: message.author.id, guildId: message.guild?.id },
      'Message command error'
    );
    if (message.guild) {
      await this.container.logging.sendAuditLog(
        message.guild,
        `\`!${command?.name ?? 'unknown'}\` failed — ${resolved.message}`,
        {
          actor: message.author,
          channel: resolveChannelContext(message.channel as GuildBasedChannel | null),
          message: resolveMessageContext(message),
          timestamp: Date.now(),
          hideDetailsSection: true
        }
      );
    }
  }
}
