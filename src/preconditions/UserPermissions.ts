import { AllFlowsPrecondition, Identifiers } from '@sapphire/framework';
import {
  PermissionsBitField,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ContextMenuCommandInteraction,
  type Message,
  type PermissionResolvable
} from 'discord.js';

const channelHasPermissionsFor = (
  channel: Message['channel']
): channel is Message['channel'] & { permissionsFor(user: Message['author']): PermissionsBitField | null } =>
  typeof (channel as { permissionsFor?: unknown }).permissionsFor === 'function';

export class UserPermissionsPrecondition extends AllFlowsPrecondition {
  private readonly dmChannelPermissions = new PermissionsBitField(
    ~new PermissionsBitField([
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.UseExternalEmojis,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.UseExternalStickers,
      PermissionFlagsBits.MentionEveryone
    ]).bitfield & PermissionsBitField.All
  ).freeze();

  public constructor(context: AllFlowsPrecondition.LoaderContext, options: AllFlowsPrecondition.Options) {
    super(context, { ...options, name: 'UserPermissions' });
  }

  public override messageRun(message: Message, _command: unknown, context: AllFlowsPrecondition.Context) {
    if (this.shouldBypass(message.author.id)) {
      return this.ok();
    }

    const required = this.resolveRequired(context.permissions);
    const channel = message.channel;
    const permissions =
      message.guild && channelHasPermissionsFor(channel)
        ? channel.permissionsFor(message.author)
        : this.dmChannelPermissions;
    return this.sharedRun(required, permissions ?? null, 'message');
  }

  public override chatInputRun(
    interaction: ChatInputCommandInteraction,
    _command: unknown,
    context: AllFlowsPrecondition.Context
  ) {
    if (this.shouldBypass(interaction.user.id)) {
      return this.ok();
    }

    const required = this.resolveRequired(context.permissions);
    const permissions = interaction.guildId ? interaction.memberPermissions : this.dmChannelPermissions;
    return this.sharedRun(required, permissions ?? null, 'chat input');
  }

  public override contextMenuRun(
    interaction: ContextMenuCommandInteraction,
    _command: unknown,
    context: AllFlowsPrecondition.Context
  ) {
    if (this.shouldBypass(interaction.user.id)) {
      return this.ok();
    }

    const required = this.resolveRequired(context.permissions);
    const permissions = interaction.guildId ? interaction.memberPermissions : this.dmChannelPermissions;
    return this.sharedRun(required, permissions ?? null, 'context menu');
  }

  private sharedRun(
    requiredPermissions: PermissionsBitField,
    availablePermissions: Readonly<PermissionsBitField> | null,
    commandType: string
  ) {
    if (!availablePermissions) {
      return this.error({
        identifier: Identifiers.PreconditionUserPermissionsNoPermissions,
        message: `I was unable to resolve the end-user's permissions in the ${commandType} command invocation channel.`
      });
    }

    const missing = availablePermissions.missing(requiredPermissions);
    return missing.length === 0
      ? this.ok()
      : this.error({
          identifier: Identifiers.PreconditionUserPermissions,
          message: `You are missing the following permissions to run this command: ${missing.join(', ')}`,
          context: { missing }
        });
  }

  private shouldBypass(_userId: string): boolean {
    void _userId;
    return false;
  }

  private resolveRequired(permissions: AllFlowsPrecondition.Context['permissions']) {
    if (!permissions) {
      return new PermissionsBitField();
    }

    if (permissions instanceof PermissionsBitField) {
      return new PermissionsBitField(permissions.bitfield);
    }

    const resolved = PermissionsBitField.resolve(permissions as PermissionResolvable);
    return new PermissionsBitField(resolved);
  }
}
