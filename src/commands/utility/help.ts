import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior, BucketScope } from '@sapphire/framework';
import { Message, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { BotClient } from '../../lib/bot-client.js';
import {
  HELP_COMPONENTS_FLAGS,
  buildCommandPanel,
  buildHelpCatalog,
  buildHelpHome,
  findHelpCommand
} from '../../lib/help-views.js';

const HELP_COOLDOWN_DELAY_MS = 3000;
const HELP_COOLDOWN_LIMIT = 2;

@ApplyOptions<Command.Options>({
  name: 'help',
  description: 'Display available commands or inspect a specific one.',
  requiredClientPermissions: ['SendMessages'],
  cooldownDelay: HELP_COOLDOWN_DELAY_MS,
  cooldownLimit: HELP_COOLDOWN_LIMIT,
  cooldownScope: BucketScope.User
})
export class HelpCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) =>
            option.setName('command').setDescription('Show details for a specific command.')
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const query = interaction.options.getString('command');
      const prefix = await this.resolveGuildPrefix(interaction.guildId ?? null);
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
      if (query) {
        await this.sendCommandHelp(interaction, prefix, query);
        return;
      }
      const modules = buildHelpCatalog(this.container.stores.get('commands').values());
      await interaction
        .editReply({
          components: [buildHelpHome(modules, prefix, interaction.user.id)],
          flags: HELP_COMPONENTS_FLAGS
        } as never)
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.debug({ err: error }, 'Failed to execute help chat input');
    }
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    try {
      const query = await args.pick('string').catch(() => null);
      const prefix = await this.resolveGuildPrefix(message.guild?.id ?? null);
      if (query) {
        await this.sendCommandHelp(message, prefix, query);
        return;
      }
      const modules = buildHelpCatalog(this.container.stores.get('commands').values());
      const channel = message.channel;
      if (!channel || !('send' in channel)) return;
      await channel
        .send({
          components: [buildHelpHome(modules, prefix, message.author.id)],
          flags: HELP_COMPONENTS_FLAGS
        } as never)
        .catch(() => undefined);
    } catch (error) {
      this.container.logger.debug({ err: error }, 'Failed to execute help message command');
    }
  }

  private async sendCommandHelp(
    source: ChatInputCommandInteraction | Message,
    prefix: string,
    rawQuery: string
  ): Promise<void> {
    const commandStore = this.container.stores.get('commands');
    const command = findHelpCommand(commandStore.values(), rawQuery);
    const modules = buildHelpCatalog(commandStore.values());
    const requesterId = source instanceof Message ? source.author.id : source.user.id;
    const moduleEntry = command ? modules.find((m) => m.entries.some((e) => e.name === command.name)) : undefined;
    const panel = command
      ? buildCommandPanel(
          command,
          prefix,
          moduleEntry?.label,
          moduleEntry ? { moduleId: moduleEntry.id, requesterId } : undefined
        )
      : null;

    if (source instanceof Message) {
      const channel = source.channel;
      if (!channel || !('send' in channel)) return;
      if (!panel) {
        await channel
          .send({ content: `I couldn't find a command named \`${rawQuery}\`. Try \`${prefix}help\` to browse.` })
          .catch(() => undefined);
        return;
      }
      await channel.send({ components: [panel], flags: HELP_COMPONENTS_FLAGS } as never).catch(() => undefined);
      return;
    }

    if (!panel) {
      const payload = { content: `I couldn't find a command named \`${rawQuery}\`. Try \`/help\` to browse.` };
      if (source.deferred) await source.editReply(payload).catch(() => undefined);
      else if (!source.replied)
        await source.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    const payload = { components: [panel], flags: HELP_COMPONENTS_FLAGS };
    if (source.deferred) await source.editReply(payload as never).catch(() => undefined);
    else if (!source.replied)
      await source.reply({ ...payload, flags: MessageFlags.Ephemeral } as never).catch(() => undefined);
  }

  private async resolveGuildPrefix(guildId: string | null): Promise<string> {
    try {
      return await (this.container.client as BotClient).getGuildPrefix(guildId);
    } catch {
      return '!';
    }
  }
}
