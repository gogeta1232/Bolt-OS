import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { type ChatInputCommandInteraction, Attachment as DiscordAttachment, Message, MessageFlags } from 'discord.js';

import { getEmoji } from '../../config/emojis.js';
import { rich, v2 } from '../../lib/embeds.js';
import { downloadDiscordImage } from '../../lib/remote-media.js';

const EMOJI_REGEX = /<a?:\w+:(\d+)>/g;
const MAX_EMOJI_SOURCE_BYTES = 512 * 1024;

@ApplyOptions<Command.Options>({
  name: 'steal',
  aliases: ['addemoji', 'add'],
  description: 'Steal an emoji or convert an image to emoji/sticker',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['ManageEmojisAndStickers', 'SendMessages'],
  requiredUserPermissions: ['ManageEmojisAndStickers']
})
export class StealCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption((option) =>
            option.setName('emoji').setDescription('The emoji to steal (paste the emoji)').setRequired(false)
          )
          .addAttachmentOption((option) =>
            option.setName('image').setDescription('Upload an image to convert to emoji/sticker').setRequired(false)
          )
          .addStringOption((option) =>
            option.setName('name').setDescription('Name for the emoji/sticker').setRequired(false)
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const emojiInput = interaction.options.getString('emoji');
    const imageAttachment = interaction.options.getAttachment('image');
    const customName = interaction.options.getString('name');

    if (!interaction.guild) {
      await interaction.reply({
        embeds: [rich({ description: 'This command can only be used in a server.', kind: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!emojiInput && !imageAttachment) {
      await interaction.reply({
        embeds: [rich({ description: 'Please provide an emoji or upload an image to steal!', kind: 'warning' })],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply();

    try {
      if (emojiInput) {
        await this.handleEmojiSteal(interaction, emojiInput, customName);
      } else if (imageAttachment) {
        await this.handleImageSteal(interaction, imageAttachment, customName);
      }
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to steal emoji');
      await interaction.editReply({
        embeds: [
          rich({
            description: `${getEmoji('danger')} Failed to steal: ${error instanceof Error ? error.message : 'Unknown error'}`,
            kind: 'danger'
          })
        ]
      });
    }
  }

  public override async messageRun(message: Message, args: Args) {
    if (!message.guild) return;

    const referencedMessage = message.reference?.messageId
      ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
      : null;

    let imageUrl: string | null = null;
    let emojiId: string | null = null;
    let isAnimated = false;
    let emojiName: string | null = null;

    const rawContent = await args.rest('string').catch(() => null);
    let customName: string | null = null;

    if (referencedMessage) {
      if (rawContent) {
        customName = rawContent.trim();
      }

      const emojiMatches = Array.from(referencedMessage.content.matchAll(EMOJI_REGEX));

      if (emojiMatches.length > 1) {
        await this.handleMassEmojiSteal(message, emojiMatches);
        return;
      }

      if (emojiMatches.length === 1) {
        const emojiText = emojiMatches[0]?.[0];
        const match = emojiText?.match(/<(a)?:(\w+):(\d+)>/);
        if (match) {
          isAnimated = !!match[1];
          emojiName = match[2] ?? null;
          emojiId = match[3] ?? null;
          if (!emojiId) return;
          imageUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
        }
      } else if (referencedMessage.stickers.size > 0) {
        const sticker = referencedMessage.stickers.first();
        if (sticker) {
          if (sticker.url) {
            imageUrl = sticker.url;
            emojiName = sticker.name || 'stolen_sticker';
            isAnimated = sticker.format === 1 || sticker.format === 2;
          }
        }
      } else if (referencedMessage.attachments.size > 0) {
        const attachment = referencedMessage.attachments.first();
        if (attachment && attachment.contentType?.startsWith('image/')) {
          imageUrl = attachment.url;
          emojiName = attachment.name?.split('.')[0] || null;
        }
      } else if (referencedMessage.embeds.length > 0) {
        const embed = referencedMessage.embeds[0];
        if (!embed) return;
        if (embed.image?.url) {
          imageUrl = embed.image.url;
          emojiName = 'stolen';
        } else if (embed.thumbnail?.url) {
          imageUrl = embed.thumbnail.url;
          emojiName = 'stolen';
        }
      }
    }

    if (!imageUrl && !emojiId) {
      if (rawContent) {
        const emojiMatches = Array.from(rawContent.matchAll(EMOJI_REGEX));

        if (emojiMatches.length > 1) {
          await this.handleMassEmojiSteal(message, emojiMatches);
          return;
        }

        if (emojiMatches.length === 1) {
          const emojiText = emojiMatches[0]?.[0];
          const match = emojiText?.match(/<(a)?:(\w+):(\d+)>/);
          if (match) {
            isAnimated = !!match[1];
            emojiName = match[2] ?? null;
            emojiId = match[3] ?? null;
            if (!emojiId || !emojiText) return;
            imageUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;

            const namePart = rawContent.replace(emojiText, '').trim();
            if (namePart.length > 0) {
              customName = namePart;
            }
          }
        } else {
          const urlPattern = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i;
          const urlMatch = rawContent.match(urlPattern);
          if (urlMatch) {
            imageUrl = urlMatch[0];
            emojiName = 'stolen';
            isAnimated = urlMatch[0].toLowerCase().endsWith('.gif');

            const namePart = rawContent.replace(urlMatch[0], '').trim();
            if (namePart.length > 0) {
              customName = namePart;
            }
          }
        }
      }
    }

    if (!imageUrl && message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment && attachment.contentType?.startsWith('image/')) {
        imageUrl = attachment.url;
        emojiName = attachment.name?.split('.')[0] || null;
        isAnimated = attachment.contentType === 'image/gif';

        if (rawContent) {
          customName = rawContent.trim();
        }
      }
    }

    if (!imageUrl) {
      const helpPayload = v2({
        title: 'Steal Emoji',
        subtitle: 'Add emoji or sticker from image',
        accent: 'info',
        blocks: [
          `**Reply:** \`!steal\` (reply to msg with emoji/image)`,
          `**Emoji:** \`!steal <:emoji:123> [name]\` • \`!steal 😀\``,
          `**Attach:** \`!steal\` + image file  •  **URL:** use a Discord CDN image link`,
          `-# Tip: custom name after emoji/URL overrides default • Requires Manage Emojis`
        ],
        footer: 'Methods: reply • emoji • attachment • URL'
      });
      await message.reply({ ...helpPayload, allowedMentions: { repliedUser: false } } as never);
      return;
    }

    try {
      await this.promptAndSteal(message.guild.id, imageUrl, customName || emojiName, message);
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to steal emoji');
      await message.reply({
        embeds: [
          rich({
            description: `${getEmoji('danger')} Failed to steal: ${error instanceof Error ? error.message : 'Unknown error'}`,
            kind: 'danger'
          })
        ],
        allowedMentions: { repliedUser: false }
      });
    }
  }

  private async handleEmojiSteal(
    interaction: ChatInputCommandInteraction,
    emojiInput: string,
    customName: string | null
  ) {
    const emojiMatch = emojiInput.match(/<(a)?:(\w+):(\d+)>/);
    if (!emojiMatch) {
      await interaction.editReply({
        embeds: [rich({ description: 'Invalid emoji format!', kind: 'warning' })]
      });
      return;
    }

    const isAnimated = !!emojiMatch[1];
    const emojiName = customName || emojiMatch[2] || 'stolen';
    const emojiId = emojiMatch[3];
    if (!emojiId) return;
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;

    await this.promptAndSteal(interaction.guild!.id, emojiUrl, emojiName, interaction);
  }

  private async handleImageSteal(
    interaction: ChatInputCommandInteraction,
    attachment: DiscordAttachment,
    customName: string | null
  ) {
    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.editReply({
        embeds: [rich({ description: 'Please upload a valid image!', kind: 'warning' })]
      });
      return;
    }

    const emojiName = customName || attachment.name?.split('.')[0] || 'stolen';
    await this.promptAndSteal(interaction.guild!.id, attachment.url, emojiName, interaction);
  }

  private async promptAndSteal(
    guildId: string,
    imageUrl: string,
    name: string | null,
    context: Message | ChatInputCommandInteraction
  ) {
    const guild = await this.container.client.guilds.fetch(guildId);
    const emojiName = (name || 'stolen').replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);

    const downloaded = await downloadDiscordImage(imageUrl, {
      maxBytes: MAX_EMOJI_SOURCE_BYTES,
      timeoutMs: 8_000
    });
    if (!downloaded) {
      const failPayload = v2({
        title: 'Invalid image',
        accent: 'warning',
        blocks: [`${getEmoji('warning')} Use an image uploaded to Discord that is no larger than 512 KiB.`]
      });
      if (context instanceof Message) await context.reply(failPayload as never);
      else await context.editReply(failPayload as never);
      return;
    }

    // Stateless: directly create emoji without local handling, handler would manage buttons if needed
    // Use Container 0x2b2d31 style for immediate feedback, then create
    try {
      const emoji = await guild.emojis.create({
        attachment: downloaded.data,
        name: emojiName,
        reason: `Stolen by ${context instanceof Message ? context.author.tag : context.user.tag}`
      });

      const successPayload = v2({
        title: 'Emoji Added',
        subtitle: `:${emoji.name}: • ${emoji.id}`,
        accent: 'success',
        thumbnailUrl: imageUrl,
        fields: [
          { name: 'Name', value: `:${emoji.name}:`, icon: 'emoji' as const },
          { name: 'ID', value: emoji.id, icon: 'settings' as const }
        ],
        blocks: [`Preview ${emoji.toString()}`],
        footer: `Added by ${context instanceof Message ? context.author.tag : context.user.tag}`
      });
      if (context instanceof Message) await context.reply(successPayload as never);
      else await context.editReply(successPayload as never);
    } catch (error) {
      this.container.logger.error({ err: error }, 'Failed to add emoji');
      const failPayload = v2({
        title: 'Failed',
        accent: 'danger',
        blocks: [`${getEmoji('danger')} Failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      });
      if (context instanceof Message) await context.reply(failPayload as never);
      else await context.editReply(failPayload as never);
    }
  }

  private async handleMassEmojiSteal(message: Message, emojiMatches: RegExpMatchArray[]) {
    if (!message.guild) return;

    const emojis: Array<{
      name: string;
      id: string;
      isAnimated: boolean;
      url: string;
    }> = [];

    for (const match of emojiMatches) {
      const parsed = match[0].match(/<(a)?:(\w+):(\d+)>/);
      if (parsed) {
        const isAnimated = !!parsed[1];
        const name = parsed[2];
        const id = parsed[3];
        if (!name || !id) continue;
        const url = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
        emojis.push({ name, id, isAnimated, url });
      }
    }

    if (emojis.length === 0) return;

    // Stateless mass steal: directly attempt without confirmation handling
    const progressPayload = v2({
      title: 'Adding Emojis',
      subtitle: `${emojis.length} emojis`,
      accent: 'info',
      blocks: [`${getEmoji('timeout')} Adding ${emojis.length} emojis... Please wait.`]
    });
    const progMsg = await message
      .reply({ ...progressPayload, allowedMentions: { repliedUser: false } } as never)
      .catch(() => null);
    const results: Array<{ name: string; success: boolean; error?: string }> = [];
    for (const emoji of emojis) {
      try {
        const emojiName = emoji.name.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);
        const downloaded = await downloadDiscordImage(emoji.url, {
          maxBytes: MAX_EMOJI_SOURCE_BYTES,
          timeoutMs: 8_000
        });
        if (!downloaded) throw new Error('Image download was rejected');
        await message.guild!.emojis.create({
          attachment: downloaded.data,
          name: emojiName,
          reason: `Mass stolen by ${message.author.tag}`
        });
        results.push({ name: emoji.name, success: true });
      } catch (error) {
        results.push({
          name: emoji.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const resultBlocks: string[] = [];
    if (successful > 0) {
      resultBlocks.push(
        `**Added:** ${results
          .filter((r) => r.success)
          .map((r) => `${getEmoji('success')} \`:${r.name}:\``)
          .join('  •  ')}`
      );
    }
    if (failed > 0) {
      resultBlocks.push(
        `**Failed:** ${results
          .filter((r) => !r.success)
          .map((r) => `${getEmoji('danger')} \`:${r.name}:\` - ${r.error}`)
          .join('\n')}`
      );
    }
    const resultPayload = v2({
      title: 'Mass Steal Complete',
      subtitle: `${successful}/${emojis.length} added • ${failed} failed`,
      accent: failed > 0 ? 'warning' : 'success',
      fields: [
        { name: 'Successful', value: `${successful}/${emojis.length}`, icon: 'success' as const },
        {
          name: 'Failed',
          value: `${failed}/${emojis.length}`,
          icon: failed > 0 ? ('danger' as const) : ('info' as const)
        }
      ],
      blocks: resultBlocks,
      footer: failed > 0 ? 'Some emojis failed — check permissions/limits' : undefined
    });
    if (progMsg && 'edit' in progMsg) await (progMsg as Message).edit(resultPayload as never).catch(() => {});
    else await message.reply(resultPayload as never).catch(() => {});
  }
}
