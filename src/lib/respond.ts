import {
  Message,
  MessageFlags,
  MessageFlagsBitField,
  type ChatInputCommandInteraction,
  type ContainerBuilder,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageReplyOptions,
  type ModalSubmitInteraction
} from 'discord.js';

import { toast, type ToastKind } from './single-line-embed.js';
import { NO_MENTIONS } from './mentions.js';

export type ReplySource = ChatInputCommandInteraction | Message | ModalSubmitInteraction;

/** Complete the original deferred reply without leaving a loading response behind. */
export async function replyOrEdit(
  source: ChatInputCommandInteraction | ModalSubmitInteraction,
  payload: Omit<InteractionReplyOptions, 'flags'> & { flags?: number }
): Promise<void> {
  const safePayload = { ...payload, allowedMentions: NO_MENTIONS };
  if (source.deferred && !source.replied) {
    const flags = new MessageFlagsBitField(payload.flags);
    const ephemeral = payload.ephemeral ?? flags.has(MessageFlags.Ephemeral);
    // Visibility cannot change when editing a deferred response. Keep private
    // errors private when an otherwise public command has been deferred.
    if (source.ephemeral !== null && source.ephemeral !== ephemeral) {
      await source.followUp(safePayload);
      await source.deleteReply();
      return;
    }
    const editableFlags: (MessageFlags.IsComponentsV2 | MessageFlags.SuppressEmbeds)[] = [];
    if (flags.has(MessageFlags.IsComponentsV2)) editableFlags.push(MessageFlags.IsComponentsV2);
    if (flags.has(MessageFlags.SuppressEmbeds)) editableFlags.push(MessageFlags.SuppressEmbeds);
    await source.editReply({ ...safePayload, flags: editableFlags });
  } else if (source.replied) {
    await source.followUp(safePayload);
  } else {
    await source.reply(safePayload);
  }
}

/**
 * One-line outcome reply for moderation commands ("@user banned • Reason: x").
 * Handles Message vs interaction vs deferred/replied + ephemeral flags.
 * WHY: every moderation command had its own 15-line respondToSource copy — now one.
 */
export async function replyToast(
  source: ReplySource,
  kind: ToastKind,
  message: string,
  options: { ephemeral?: boolean } = {}
): Promise<void> {
  const ephemeral = options.ephemeral ?? !(source instanceof Message);

  if (source instanceof Message) {
    const payload = toast(kind, message);
    await source.reply({ ...payload, allowedMentions: NO_MENTIONS });
    return;
  }

  const payload = ephemeral ? toast(kind, message, true) : toast(kind, message);

  await replyOrEdit(source, payload);
}

/**
 * Sends a prebuilt V2 Container with Toast-like visibility + mention safety.
 * WHY: minimal confirmations need custom small headers (no ## big title) that v2() can't express.
 */
export async function replyContainer(
  source: ReplySource,
  container: ContainerBuilder,
  replyOptions: { ephemeral?: boolean } = {}
): Promise<void> {
  const ephemeral = replyOptions.ephemeral ?? !(source instanceof Message);

  if (source instanceof Message) {
    const payload = {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS
    } satisfies MessageReplyOptions;
    await source.reply(payload);
    return;
  }

  if (source.deferred) {
    const payload = {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS
    } satisfies InteractionEditReplyOptions;
    await source.editReply(payload);
    return;
  }

  const payload = {
    components: [container],
    flags: ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    allowedMentions: NO_MENTIONS
  } satisfies InteractionReplyOptions;

  if (source.replied) {
    await source.followUp(payload);
    return;
  }
  await source.reply(payload);
}

/** Denied-permission shortcut — same copy everywhere, now one call. */
export const replyNoPermission = (source: ReplySource) =>
  replyToast(source, 'warning', 'You do not have permission to use this command.');

/** Guild-only shortcut. */
export const replyGuildOnly = (source: ReplySource) =>
  replyToast(source, 'warning', 'This command can only be used in a server.');

export { toast };
export type { ToastKind };
