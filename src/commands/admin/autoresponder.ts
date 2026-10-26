import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  MessageFlags,
  type ChatInputCommandInteraction,
  type EmbedBuilder
} from 'discord.js';

import { AdminCommand } from '../../lib/structures/AdminCommand.js';
import { createEmbed } from '../../config/theme.js';
import { replyOrEdit } from '../../lib/respond.js';
import { getEmoji } from '../../config/emojis.js';
import type { AutoResponderDocument } from '../../database/models/features/AutoResponder.js';

const MAX_TRIGGER_LENGTH = 200;
const MAX_RESPONSE_LENGTH = 2_000;
const MAX_LIST_DESCRIPTION_LENGTH = 3_500;

@ApplyOptions<Command.Options>({
  name: 'autoresponder',
  description: 'Manage auto responses.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['SendMessages']
})
export class AutoResponderCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('add')
              .setDescription('Add a new auto responder')
              .addStringOption((option) =>
                option.setName('trigger').setDescription('Message trigger').setRequired(true).setMaxLength(200)
              )
              .addStringOption((option) =>
                option.setName('response').setDescription('Bot response').setRequired(true).setMaxLength(2_000)
              )
              .addBooleanOption((option) =>
                option.setName('case_sensitive').setDescription('Trigger is case sensitive')
              )
              .addBooleanOption((option) =>
                option.setName('use_embed').setDescription('Send response as embed (default: false)')
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove an auto responder')
              .addStringOption((option) =>
                option.setName('trigger').setDescription('Trigger to remove').setRequired(true)
              )
          )
          .addSubcommand((sub) => sub.setName('list').setDescription('List configured auto responders')),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand(true);
    switch (subcommand) {
      case 'add':
        await this.addResponder(interaction);
        break;
      case 'remove':
        await this.removeResponder(interaction);
        break;
      case 'list':
        await this.listResponders(interaction);
        break;
    }
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;
    const subcommand = await args.pick('string').catch(() => null);
    if (!subcommand) {
      await channel.send({ embeds: [createEmbed({ description: 'Specify add, remove, or list.', type: 'warning' })] });
      return;
    }
    switch (subcommand.toLowerCase()) {
      case 'add': {
        const trigger = await args.pick('string').catch(() => null);
        const response = await args.rest('string').catch(() => null);
        if (!trigger || !response) {
          await channel.send({
            embeds: [createEmbed({ description: 'Usage: autoresponder add <trigger> <response>', type: 'warning' })]
          });
          return;
        }
        if (trigger.length > MAX_TRIGGER_LENGTH || response.length > MAX_RESPONSE_LENGTH) {
          await channel.send({
            embeds: [
              createEmbed({
                description: 'Triggers may use up to 200 characters and responses up to 2,000 characters.',
                type: 'warning'
              })
            ]
          });
          return;
        }
        await this.saveResponder(message, {
          guildId: message.guild!.id,
          trigger,
          response,
          caseSensitive: false,
          useEmbed: false,
          createdBy: message.author.id,
          createdAt: new Date()
        });
        break;
      }
      case 'remove': {
        const trigger = await args.rest('string').catch(() => null);
        if (!trigger) {
          await channel.send({
            embeds: [createEmbed({ description: 'Usage: autoresponder remove <trigger>', type: 'warning' })]
          });
          return;
        }
        await this.container.autoResponders.remove(message.guild!.id, trigger);
        await channel.send({
          embeds: [createEmbed({ description: `Responder removed for "${trigger}"`, type: 'success' })]
        });
        await this.container.logging.sendAuditLog(
          message.guild!,
          `${getEmoji('deletion')} Auto responder removed: ${trigger}`
        );
        break;
      }
      case 'list': {
        const responders = await this.container.autoResponders.list(message.guild!.id);
        const description = this.formatResponderList(responders);
        await channel.send({ embeds: [createEmbed({ description, type: 'info' })] });
        break;
      }
      default:
        await channel.send({
          embeds: [createEmbed({ description: 'Specify add, remove, or list.', type: 'warning' })]
        });
    }
  }

  private async addResponder(interaction: ChatInputCommandInteraction) {
    const trigger = interaction.options.getString('trigger', true);
    const response = interaction.options.getString('response', true);
    const caseSensitive = interaction.options.getBoolean('case_sensitive') ?? false;
    const useEmbed = interaction.options.getBoolean('use_embed') ?? false;
    await this.saveResponder(interaction, {
      guildId: interaction.guildId!,
      trigger,
      response,
      caseSensitive,
      useEmbed,
      createdBy: interaction.user.id,
      createdAt: new Date()
    });
  }

  private async saveResponder(
    source: Message | ChatInputCommandInteraction,
    entry: AutoResponderDocument
  ): Promise<void> {
    const send = async (payload: {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
    }): Promise<void> => {
      if (source instanceof Message) {
        if ('send' in source.channel) await source.channel.send({ ...payload, allowedMentions: { parse: [] } });
      } else {
        await replyOrEdit(source, { ...payload, flags: MessageFlags.Ephemeral });
      }
    };
    const outcome = async (description: string, type: 'success' | 'warning' | 'danger'): Promise<void> => {
      await send({ embeds: [createEmbed({ description, type })] });
    };
    try {
      const result = await this.container.autoResponders.add(entry);
      if (result === 'exists') {
        const pending = await this.container.autoResponders.prepareOverwrite(entry);
        if (pending === 'same') {
          await outcome(`A responder already exists for "${entry.trigger}" with the same response.`, 'warning');
        } else if (pending === 'missing') {
          await outcome('That responder was removed. Run the add command again.', 'warning');
        } else if (pending === 'busy') {
          await outcome('Too many confirmations are pending. Try again shortly.', 'warning');
        } else {
          const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`autoresponder:overwrite:${pending.token}`)
              .setLabel('Overwrite')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`autoresponder:cancel:${pending.token}`)
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          );
          await send({
            embeds: [
              createEmbed({
                description: `Overwrite the existing response for "${entry.trigger}"?\n\nNew response:\n${entry.response}\n\nConfirm within 2 minutes.`,
                type: 'warning'
              })
            ],
            components: [controls]
          });
        }
        return;
      }
    } catch (error) {
      this.container.logger.error({ err: error, guildId: entry.guildId }, 'Failed to add autoresponder');
      await outcome('Could not add the responder. Try again shortly.', 'danger');
      return;
    }
    await outcome(`Responder added for "${entry.trigger}"`, 'success');
    if (source.guild) {
      await this.container.logging.sendAuditLog(
        source.guild,
        `${getEmoji('autoResponder')} Auto responder added: ${entry.trigger}`
      );
    }
  }

  private async removeResponder(interaction: ChatInputCommandInteraction) {
    const trigger = interaction.options.getString('trigger', true);
    await this.container.autoResponders.remove(interaction.guildId!, trigger);
    await replyOrEdit(interaction, {
      embeds: [createEmbed({ description: `Responder removed for "${trigger}"`, type: 'success' })],
      flags: MessageFlags.Ephemeral
    });
    await this.container.logging.sendAuditLog(
      interaction.guild!,
      `${getEmoji('deletion')} Auto responder removed: ${trigger}`
    );
  }

  private async listResponders(interaction: ChatInputCommandInteraction) {
    const responders = await this.container.autoResponders.list(interaction.guildId!);
    const description = this.formatResponderList(responders);
    await replyOrEdit(interaction, {
      embeds: [createEmbed({ description, type: 'info' })],
      flags: MessageFlags.Ephemeral
    });
  }

  private formatResponderList(responders: readonly AutoResponderDocument[]): string {
    if (responders.length === 0) return 'No responders configured.';

    const lines: string[] = [];
    let usedCharacters = 0;
    for (const responder of responders) {
      const line = `**${responder.trigger}** → ${responder.response}`;
      if (usedCharacters + line.length > MAX_LIST_DESCRIPTION_LENGTH) break;
      lines.push(line);
      usedCharacters += line.length + 1;
    }

    const hiddenCount = responders.length - lines.length;
    if (hiddenCount > 0) lines.push(`…and ${hiddenCount} more.`);
    return lines.join('\n');
  }
}
