import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Message, MessageFlags, PermissionFlagsBits, TextChannel } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { AdminCommand } from '../../lib/structures/AdminCommand.js';

@ApplyOptions<Command.Options>({
  name: 'setgreetchannel',
  description: 'Manage channels for greeting new members.',
  requiredClientPermissions: ['SendMessages'],
  enabled: true,
  runIn: ['GUILD_ANY'],
  fullCategory: ['admin'],
  requiredUserPermissions: [PermissionFlagsBits.ManageGuild]
})
export class SetGreetChannelCommand extends AdminCommand {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('add')
              .setDescription('Add channels for greeting new members')
              .addStringOption((option) =>
                option
                  .setName('channels')
                  .setDescription('A list of channels to add (e.g. #channel1 #channel2)')
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove channels from greeting new members')
              .addStringOption((option) =>
                option
                  .setName('channels')
                  .setDescription('A list of channels to remove (e.g. #channel1 #channel2)')
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) => sub.setName('list').setDescription('List all greet channels'))
          .addSubcommand((sub) =>
            sub
              .setName('message')
              .setDescription('Set the greet message template')
              .addStringOption((option) =>
                option
                  .setName('template')
                  .setDescription('Message template (use {{user}} for user mention)')
                  .setRequired(true)
                  .setMaxLength(2_000)
              )
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    await this.ensureAdmin(interaction);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const channelsStr = interaction.options.getString('channels', true);
      const channels = this.resolveChannelsFromString(interaction, channelsStr);
      if (channels.length === 0) {
        await interaction.reply({
          embeds: [createEmbed({ description: 'No valid channels found in your input.', type: 'warning' })],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await this.addGreetChannels(interaction, channels);
    } else if (subcommand === 'remove') {
      const channelsStr = interaction.options.getString('channels', true);
      const channels = this.resolveChannelsFromString(interaction, channelsStr);
      if (channels.length === 0) {
        await interaction.reply({
          embeds: [createEmbed({ description: 'No valid channels found in your input.', type: 'warning' })],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await this.removeGreetChannels(interaction, channels);
    } else if (subcommand === 'list') {
      await this.listGreetChannels(interaction);
    } else if (subcommand === 'message') {
      const template = interaction.options.getString('template', true);
      await this.setGreetMessage(interaction, template);
    }
  }

  public override async messageRun(message: Message, args: Args) {
    await this.ensureAdmin(message);
    const channel = message.channel;
    if (!channel || !('send' in channel)) return;

    const subcommand = await args.pick('string').catch(() => 'list');

    if (subcommand === 'add') {
      const channels = await this.resolveChannelsFromMessage(message);
      if (channels.length === 0) {
        await channel.send({
          embeds: [createEmbed({ description: 'Please mention the channels you want to add.', type: 'warning' })]
        });
        return;
      }
      await this.addGreetChannels(message, channels);
    } else if (subcommand === 'remove') {
      const channels = await this.resolveChannelsFromMessage(message);
      if (channels.length === 0) {
        await channel.send({
          embeds: [createEmbed({ description: 'Please mention the channels you want to remove.', type: 'warning' })]
        });
        return;
      }
      await this.removeGreetChannels(message, channels);
    } else if (subcommand === 'message') {
      const template = await args.rest('string').catch(() => null);
      if (!template || template.length > 2_000) {
        await channel.send({ embeds: [createEmbed({ description: 'Provide a message template.', type: 'warning' })] });
        return;
      }

      await this.setGreetMessage(message, template);
    } else {
      await this.listGreetChannels(message);
    }
  }

  private resolveChannelsFromString(interaction: ChatInputCommandInteraction, channelsStr: string): TextChannel[] {
    const channelMentions = channelsStr.match(/<#\d+>/g) || [];
    const channelIds = channelMentions.map((mention) => mention.replace(/[<#>]/g, ''));

    return channelIds
      .map((id) => interaction.guild?.channels.cache.get(id))
      .filter((channel): channel is TextChannel => !!channel && channel.type === 0);
  }

  private async resolveChannelsFromMessage(message: Message): Promise<TextChannel[]> {
    return Array.from(message.mentions.channels.values()).filter(
      (channel): channel is TextChannel => channel.type === 0
    );
  }

  private async addGreetChannels(source: ChatInputCommandInteraction | Message, channels: TextChannel[]) {
    const config = await this.container.config.fetch(source.guild!.id);
    const greetChannels = new Set(config.greetChannels || []);

    const addedChannels: TextChannel[] = [];
    const alreadyPresentChannels: TextChannel[] = [];

    for (const channel of channels) {
      if (greetChannels.has(channel.id)) {
        alreadyPresentChannels.push(channel);
      } else {
        greetChannels.add(channel.id);
        addedChannels.push(channel);
      }
    }

    await this.container.config.set(source.guild!.id, { greetChannels: Array.from(greetChannels) });

    let description = '';
    if (addedChannels.length > 0) {
      description += `Added ${addedChannels.map((c) => c.toString()).join(', ')} to greet channels.\n`;
    }
    if (alreadyPresentChannels.length > 0) {
      description += `${alreadyPresentChannels.map((c) => c.toString()).join(', ')} were already in the list.\n`;
    }
    description += `Total greet channels: ${greetChannels.size}`;

    if (source instanceof Message) {
      if (source.channel.isTextBased() && 'send' in source.channel) {
        await source.channel.send({ embeds: [createEmbed({ description, type: 'success' })] });
      }
    } else {
      await source.reply({ embeds: [createEmbed({ description, type: 'success' })], flags: MessageFlags.Ephemeral });
    }

    const actor = source instanceof Message ? source.author : source.user;
    await this.container.logging.sendAuditLog(
      source.guild!,
      `${getEmoji('audit')} Greet channels added: ${addedChannels.map((c) => c.toString()).join(', ')}`,
      {
        actor,
        target: null,
        metadata: {
          'Added Channels': addedChannels.map((c) => c.name).join(', ') || 'None',
          'Total Greet Channels': greetChannels.size
        }
      }
    );
  }

  private async removeGreetChannels(source: ChatInputCommandInteraction | Message, channels: TextChannel[]) {
    const config = await this.container.config.fetch(source.guild!.id);
    const greetChannels = new Set(config.greetChannels || []);

    const removedChannels: TextChannel[] = [];
    const notFoundChannels: TextChannel[] = [];

    for (const channel of channels) {
      if (greetChannels.has(channel.id)) {
        greetChannels.delete(channel.id);
        removedChannels.push(channel);
      } else {
        notFoundChannels.push(channel);
      }
    }

    await this.container.config.set(source.guild!.id, { greetChannels: Array.from(greetChannels) });

    let description = '';
    if (removedChannels.length > 0) {
      description += `Removed ${removedChannels.map((c) => c.toString()).join(', ')} from greet channels.\n`;
    }
    if (notFoundChannels.length > 0) {
      description += `${notFoundChannels.map((c) => c.toString()).join(', ')} were not in the list.\n`;
    }
    description += `Total greet channels: ${greetChannels.size}`;

    if (source instanceof Message) {
      if (source.channel.isTextBased() && 'send' in source.channel) {
        await source.channel.send({ embeds: [createEmbed({ description, type: 'success' })] });
      }
    } else {
      await source.reply({ embeds: [createEmbed({ description, type: 'success' })], flags: MessageFlags.Ephemeral });
    }

    const actor = source instanceof Message ? source.author : source.user;
    await this.container.logging.sendAuditLog(
      source.guild!,
      `${getEmoji('audit')} Greet channels removed: ${removedChannels.map((c) => c.toString()).join(', ')}`,
      {
        actor,
        target: null,
        metadata: {
          'Removed Channels': removedChannels.map((c) => c.name).join(', ') || 'None',
          'Total Greet Channels': greetChannels.size
        }
      }
    );
  }

  private async listGreetChannels(source: ChatInputCommandInteraction | Message) {
    const config = await this.container.config.fetch(source.guild!.id);
    const greetChannels = config.greetChannels || [];

    if (greetChannels.length === 0) {
      const description = 'No greet channels configured. Use `/setgreetchannel add #channel` to add one.';
      if (source instanceof Message) {
        const originChannel = source.channel;
        if (originChannel && 'send' in originChannel) {
          await originChannel.send({ embeds: [createEmbed({ description, type: 'info' })] });
        }
      } else {
        await source.reply({ embeds: [createEmbed({ description, type: 'info' })], flags: MessageFlags.Ephemeral });
      }
      return;
    }

    const channelList = greetChannels.map((id) => `<#${id}>`).join(', ');
    const description = `Greet channels (${greetChannels.length}):\n${channelList}`;
    if (source instanceof Message) {
      const originChannel = source.channel;
      if (originChannel && 'send' in originChannel) {
        await originChannel.send({ embeds: [createEmbed({ description, type: 'info' })] });
      }
    } else {
      await source.reply({ embeds: [createEmbed({ description, type: 'info' })], flags: MessageFlags.Ephemeral });
    }
  }

  private async setGreetMessage(source: ChatInputCommandInteraction | Message, template: string) {
    await this.container.config.set(source.guild!.id, { greetMessage: template });

    const description = `Greet message template updated to: ${template}`;
    if (source instanceof Message) {
      const originChannel = source.channel;
      if (originChannel && 'send' in originChannel) {
        await originChannel.send({ embeds: [createEmbed({ description, type: 'success' })] });
      }
    } else {
      await source.reply({ embeds: [createEmbed({ description, type: 'success' })], flags: MessageFlags.Ephemeral });
    }

    const actor = source instanceof Message ? source.author : source.user;
    await this.container.logging.sendAuditLog(source.guild!, `${getEmoji('audit')} Greet message template updated`, {
      actor,
      target: null,
      metadata: {
        'New Template': template
      }
    });
  }
}
