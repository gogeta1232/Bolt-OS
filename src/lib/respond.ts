import {
  Message,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ContainerBuilder,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageReplyOptions,
  type ModalSubmitInteraction
} from 'discord.js';

import { toast, type ToastKind } from './single-line-embed.js';

export type ReplySource = ChatInputCommandInteraction | Message | ModalSubmitInteraction;

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
    await source.reply({ ...payload, allowedMentions: { repliedUser: false } });
    return;
  }

  const payload = ephemeral ? toast(kind, message, true) : toast(kind, message);

  if ('deferred' in source && (source.deferred || source.replied)) {
    await source.followUp(payload);
    return;
  }

  await source.reply(payload);
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
      allowedMentions: { parse: [], repliedUser: false }
    } satisfies MessageReplyOptions;
    await source.reply(payload);
    return;
  }

  if (source.deferred) {
    const payload = {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], repliedUser: false }
    } satisfies InteractionEditReplyOptions;
    await source.editReply(payload);
    return;
  }

  const payload = {
    components: [container],
    flags: ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false }
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
