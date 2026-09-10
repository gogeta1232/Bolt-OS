import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type GuildMember,
  Message
} from 'discord.js';

import { buildAfkSetContainer, extractImageUrlFromText, isImageAttachment } from '../../lib/afk-views.js';
import { getEmoji } from '../../config/emojis.js';
import { downloadDiscordImage } from '../../lib/remote-media.js';

const MAX_AFK_MESSAGE_LENGTH = 200;
const AFK_FETCH_TIMEOUT_MS = 8000;
const AFK_MAX_BYTES = 8_000_000;

const tryFetchAfkFile = async (url: string): Promise<AttachmentBuilder | null> => {
  const downloaded = await downloadDiscordImage(url, { maxBytes: AFK_MAX_BYTES, timeoutMs: AFK_FETCH_TIMEOUT_MS });
  if (!downloaded) return null;
  const extension = downloaded.extension === 'bin' ? 'png' : downloaded.extension;
  return new AttachmentBuilder(downloaded.data, { name: `afk-${Date.now()}.${extension}` });
};

const isAdmin = (member: GuildMember | null): boolean => {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
};

@ApplyOptions<Command.Options>({
  name: 'afk',
  description: 'Set or clear your AFK status (admins can manage others).',
  requiredClientPermissions: ['SendMessages'],
  runIn: ['GUILD_ANY']
})
export class AfkCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addSubcommand((sub) =>
            sub
              .setName('set')
              .setDescription('Set your AFK status (admins can set for others).')
              .addStringOption((o) =>
                o.setName('message').setDescription('AFK reason').setMaxLength(MAX_AFK_MESSAGE_LENGTH)
              )
              .addAttachmentOption((o) => o.setName('image').setDescription('Image/GIF to show (no videos)'))
              .addUserOption((o) => o.setName('user').setDescription('Target user (admin only)'))
              .addBooleanOption((o) => o.setName('remove_image').setDescription('Remove existing image (admin only)'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('clear')
              .setDescription('Clear AFK status.')
              .addUserOption((o) => o.setName('user').setDescription('Target user (admin only)'))
          )
          .addSubcommand((sub) =>
            sub
              .setName('status')
              .setDescription('Check your AFK status or another user')
              .addUserOption((o) => o.setName('user').setDescription('User to check'))
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember | null;

    if (sub === 'clear') {
      const target = interaction.options.getUser('user');
      if (target && target.id !== interaction.user.id) {
        if (!isAdmin(member)) {
          await interaction.reply({ content: 'Only admins can clear others AFK.', flags: MessageFlags.Ephemeral });
          return;
        }
        const cleared = await this.container.afk.clear(interaction.guild.id, target.id);
        await interaction.reply({
          content: cleared ? `Cleared AFK for ${target.tag}.` : `${target.tag} was not AFK.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const cleared = await this.container.afk.clear(interaction.guild.id, interaction.user.id);
      await interaction.reply({
        content: cleared ? 'You are no longer AFK.' : 'You were not AFK.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === 'status') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const profile = await this.container.afk.fetch(interaction.guild.id, target.id);
      if (!profile) {
        await interaction.reply({
          content: `${target.id === interaction.user.id ? 'You are' : `${target.tag} is`} not AFK.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const ts = Math.floor(new Date(profile.setAt).getTime() / 1000);
      const attachNote = profile.attachmentUrl ? ` · ${getEmoji('paperclip')} image` : '';
      await interaction.reply({
        content: `${target.tag} is AFK: ${profile.message} (since <t:${ts}:R>)${attachNote}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // set
    const rawMessage = interaction.options.getString('message') ?? 'AFK';
    const imageAtt = interaction.options.getAttachment('image');
    const targetUser = interaction.options.getUser('user');
    const removeImage = interaction.options.getBoolean('remove_image') ?? false;

    let targetId = interaction.user.id;
    let targetTag = interaction.user.tag;
    let targetMember = member;
    if (targetUser && targetUser.id !== interaction.user.id) {
      if (!isAdmin(member)) {
        await interaction.reply({ content: 'Only admins can set AFK for others.', flags: MessageFlags.Ephemeral });
        return;
      }
      targetId = targetUser.id;
      targetTag = targetUser.tag;
      targetMember = interaction.guild.members.cache.get(targetId) as GuildMember | null;
      void targetMember;
    }

    // Validate image is not video — allow gif that Discord serves as video/mp4
    if (imageAtt && imageAtt.contentType?.startsWith('video/') && !imageAtt.name.toLowerCase().endsWith('.gif')) {
      await interaction.reply({ content: 'Videos are not allowed — only images/GIFs.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (imageAtt && !isImageAttachment({ contentType: imageAtt.contentType, name: imageAtt.name, url: imageAtt.url })) {
      await interaction.reply({
        content: 'Only images/GIFs allowed (png, jpg, jpeg, gif, webp).',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const textImage = extractImageUrlFromText(rawMessage);
    const slashAtt = imageAtt ? { url: imageAtt.url, contentType: imageAtt.contentType, name: imageAtt.name } : null;
    // Priority: slash attachment > text gif
    let attachmentUrl: string | null | undefined = undefined;
    if (removeImage) attachmentUrl = null;
    else if (slashAtt) attachmentUrl = slashAtt.url;
    else if (textImage) attachmentUrl = textImage;

    // Early fetch to know if we can re-upload (avoids broken MediaGallery for 404/expired urls)
    let earlyFiles: AttachmentBuilder[] | undefined;
    let earlyDisplayUrl: string | null | undefined = attachmentUrl ?? undefined;
    let canReupload = false;
    if (attachmentUrl) {
      const earlyFetched = await tryFetchAfkFile(attachmentUrl);
      if (earlyFetched) {
        earlyFiles = [earlyFetched];
        const fname = (earlyFetched as unknown as { name?: string }).name ?? `afk-${Date.now()}.gif`;
        earlyDisplayUrl = `attachment://${fname}`;
        canReupload = true;
      } else if (attachmentUrl === textImage) {
        // Pasted URL is 404/expired — don't show broken gallery, keep link in text
        earlyDisplayUrl = undefined;
        canReupload = false;
      }
    }

    let finalMessage = rawMessage.trim() || 'AFK';
    if (canReupload && textImage && finalMessage.includes(textImage)) {
      finalMessage = finalMessage.replace(textImage, '').trim() || 'AFK';
      finalMessage = finalMessage.replace(/\s{2,}/g, ' ').trim() || 'AFK';
    }
    const existing = await this.container.afk.fetch(interaction.guild.id, targetId);
    if (existing) {
      const existingAttach = existing.attachmentUrl ?? null;
      const resolvedNewAttach = attachmentUrl === undefined ? existingAttach : attachmentUrl;
      const isSameMessage = existing.message === finalMessage;
      const isSameAttach = resolvedNewAttach === existingAttach;
      // Don't reset if already AFK with same content (prevents !afk spam resetting timer)
      if (isSameMessage && isSameAttach) {
        await interaction.reply({
          content: `You're already AFK: ${existing.message}${existingAttach ? ' · ' + getEmoji('paperclip') : ''} · <t:${Math.floor(new Date(existing.setAt).getTime() / 1000)}:R>`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      // If user sends bare !afk (no reason, no image) while already AFK, treat as already AFK regardless of message
      const isBareAfk =
        !removeImage && !slashAtt && !textImage && (rawMessage.trim() === '' || rawMessage.trim() === 'AFK');
      if (isBareAfk) {
        await interaction.reply({
          content: `You're already AFK: ${existing.message}${existingAttach ? ' · ' + getEmoji('paperclip') : ''} · <t:${Math.floor(new Date(existing.setAt).getTime() / 1000)}:R>`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }
    const profile = await this.container.afk.set({
      guildId: interaction.guild.id,
      userId: targetId,
      message: finalMessage,
      attachmentUrl
    });
    void profile;
    const stored = await this.container.afk.fetch(interaction.guild.id, targetId);
    let finalAttach: string | null = stored?.attachmentUrl ?? attachmentUrl ?? null;

    // Use early fetched file if we have it, otherwise try to fetch stored (for existing image kept)
    let files: AttachmentBuilder[] | undefined = earlyFiles;
    let displayUrl: string | null | undefined = earlyDisplayUrl ?? finalAttach ?? undefined;
    if (!files && finalAttach) {
      // If we didn't already fetch (e.g., keeping existing attachment), try now
      if (finalAttach !== attachmentUrl || !earlyFiles) {
        const fetched = await tryFetchAfkFile(finalAttach);
        if (fetched) {
          files = [fetched];
          const fname = (fetched as unknown as { name?: string }).name ?? `afk-${Date.now()}.gif`;
          displayUrl = `attachment://${fname}`;
        } else if (finalAttach === textImage || !canReupload) {
          // Still 404 — hide gallery to avoid broken image
          displayUrl = undefined;
        }
      }
    }
    // If we had a paste that failed, ensure no broken gallery
    if (attachmentUrl === textImage && !canReupload) {
      displayUrl = undefined;
      files = undefined;
    }

    const containerPayload = buildAfkSetContainer({
      userTag: targetTag,
      userId: targetId,
      message: finalMessage,
      attachmentUrl: displayUrl ?? undefined,
      isEphemeral: true,
      guildName: interaction.guild.name
    });

    const isOther = targetId !== interaction.user.id;
    if (isOther) {
      await interaction.reply({ content: `Set AFK for ${targetTag}.`, flags: MessageFlags.Ephemeral });
      // Optionally send public notice? Keep ephemeral
      return;
    }

    if (files) {
      await interaction.reply({ ...containerPayload, files } as never);
    } else {
      await interaction.reply(containerPayload as never);
    }
  }

  public override async messageRun(message: Message, args: Args) {
    if (!message.guild) return;
    const guild = message.guild;
    const member = message.member as GuildMember | null;

    // Try to parse subcommand, but be flexible for prefix
    const peek = await args
      .peekResult('string')
      .catch(() => null as unknown as import('@sapphire/framework').Result<string, unknown>);
    let sub = '';
    if (peek && (peek as unknown as { isOk(): boolean }).isOk()) {
      const v = await args.pick('string').catch(() => '');
      sub = v.toLowerCase();
    }

    // Handle clear
    if (sub === 'clear' || sub === 'remove' || sub === 'off') {
      // Check if admin targets someone else via mention or ID
      const remainder = await args.rest('string').catch(() => '');
      const mentionId = message.mentions.users.first()?.id ?? this.extractId(remainder);
      if (mentionId && mentionId !== message.author.id) {
        if (!isAdmin(member)) {
          await message.reply({ embeds: [] as never, content: 'Only admins can clear others AFK.' } as never);
          return;
        }
        const targetUser = await message.guild.members.fetch(mentionId).catch(() => null);
        const tag = targetUser?.user.tag ?? `<@${mentionId}>`;
        await this.container.afk.clear(guild.id, mentionId);
        await message.reply(`Cleared AFK for ${tag}.`);
        return;
      }
      // Check for remove image variant: clear-attachment
      if (remainder.trim().toLowerCase().includes('image') || remainder.trim().toLowerCase().includes('gif')) {
        // Admin wants to remove image only? We'll handle as remove attachment
        const targetIdForImage = mentionId ?? message.author.id;
        if (targetIdForImage !== message.author.id && !isAdmin(member)) {
          await message.reply('Only admins can edit others.');
          return;
        }
        const prof = await this.container.afk.fetch(guild.id, targetIdForImage);
        if (!prof) {
          await message.reply('User is not AFK.');
          return;
        }
        await this.container.afk.set({
          guildId: guild.id,
          userId: targetIdForImage,
          message: prof.message,
          attachmentUrl: null
        });
        await message.reply(`Removed AFK image for <@${targetIdForImage}>.`);
        return;
      }
      const cleared = await this.container.afk.clear(guild.id, message.author.id);
      await message.reply(cleared ? 'You are no longer AFK.' : 'You were not AFK.');
      return;
    }

    // Handle admin set for others: !afk set @user reason or !afk @user reason
    // Detect if first remainder token is a mention/ID and admin
    let targetId: string | null = null;
    let afkText = '';

    // Reconstruct full content after !afk
    const fullContent = message.content.trim();
    const withoutPrefix = fullContent.replace(/^[!.?]?afk\s*/i, '').trim();

    // If starts with mention/ID and admin, treat as admin edit
    const firstToken = withoutPrefix.split(/\s+/)[0] ?? '';
    const possibleTargetId = this.extractId(firstToken) ?? message.mentions.users.first()?.id ?? null;
    if (possibleTargetId && possibleTargetId !== message.author.id && isAdmin(member)) {
      targetId = possibleTargetId;
      afkText = withoutPrefix.slice(firstToken.length).trim();
      // If sub was 'set' and we already consumed 'set', handle
      if (sub === 'set') {
        // withoutPrefix already includes 'set'? Actually we stripped 'afk' only, so if user did '!afk set @user hi', withoutPrefix is 'set @user hi', firstToken is 'set', not target
        // Need to handle 'set' prefix
        if (afkText.toLowerCase().startsWith('set')) {
          // Already handled? Let's re-parse more simply: if sub === 'set', then target is next token after set
        }
      }
      // Re-evaluate for 'set' case
      if (sub === 'set') {
        const afterSet = withoutPrefix.replace(/^set\s*/i, '').trim();
        const afterSetFirst = afterSet.split(/\s+/)[0] ?? '';
        const afterSetTarget = this.extractId(afterSetFirst) ?? null;
        if (afterSetTarget && afterSetTarget !== message.author.id) {
          targetId = afterSetTarget;
          afkText = afterSet.slice(afterSetFirst.length).trim();
        } else {
          targetId = null;
          afkText = afterSet;
        }
      }
    } else {
      // Not admin edit, afkText is the whole withoutPrefix (if sub was not clear)
      if (sub === 'set') {
        afkText = withoutPrefix.replace(/^set\s*/i, '').trim();
      } else if (sub && sub !== 'clear' && sub !== 'remove') {
        // sub is actually part of message (e.g., 'hello')
        afkText = [sub, await args.rest('string').catch(() => '')].filter(Boolean).join(' ').trim();
        if (!afkText) afkText = withoutPrefix;
      } else {
        afkText = await args.rest('string').catch(() => '');
        if (sub && sub !== 'set' && sub !== 'clear') afkText = `${sub} ${afkText}`.trim();
        if (!afkText) afkText = withoutPrefix;
      }
      if (sub === 'set' && !afkText) afkText = '';
    }

    // If afkText empty and no attachment, default to AFK
    const attachments = message.attachments;
    const hasImageAttachment = [...attachments.values()].some((a) => isImageAttachment(a));
    const imageFromAttachments = hasImageAttachment
      ? ([...attachments.values()].find((a) => isImageAttachment(a))?.url ?? null)
      : null;
    const imageFromText = extractImageUrlFromText(afkText);
    // Also check embeds (when user pastes a GIF URL like tenor.com/view/..., Discord unfurls it as an embed with direct media URL)
    let imageFromEmbeds: string | null = null;
    if (!imageFromAttachments && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        const url =
          embed.image?.url ??
          embed.thumbnail?.url ??
          (embed as unknown as { video?: { url?: string } }).video?.url ??
          null;
        if (
          url &&
          (url.toLowerCase().endsWith('.gif') ||
            url.toLowerCase().endsWith('.png') ||
            url.toLowerCase().endsWith('.jpg') ||
            url.toLowerCase().endsWith('.jpeg') ||
            url.toLowerCase().endsWith('.webp') ||
            url.includes('tenor.com') ||
            url.includes('giphy.com') ||
            url.includes('cdn.discordapp.com') ||
            url.includes('media.discordapp.net'))
        ) {
          // Ensure it's an image URL, not a page
          try {
            const p = new URL(url);
            const ext = p.pathname.toLowerCase().split('.').pop() ?? '';
            if (
              ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ||
              p.host.includes('tenor.com') ||
              p.host.includes('giphy.com')
            ) {
              imageFromEmbeds = url;
              break;
            }
          } catch {
            continue;
          }
        }
      }
    }

    // Validate video not allowed — allow gif that Discord serves as video/mp4
    const hasVideo = [...attachments.values()].some(
      (a) => a.contentType?.startsWith('video/') && !a.name?.toLowerCase().endsWith('.gif')
    );
    if (hasVideo) {
      await message.reply('Videos are not allowed — only images/GIFs.');
      return;
    }

    const finalTargetId = targetId ?? message.author.id;
    const finalTargetTag = targetId
      ? ((await guild.members.fetch(targetId).catch(() => null))?.user.tag ?? `<@${targetId}>`)
      : message.author.tag;

    // Determine attachmentUrl to store — priority: file attachment > embed image > pasted URL
    let attachmentUrl: string | null | undefined = undefined;
    if (imageFromAttachments) attachmentUrl = imageFromAttachments;
    else if (imageFromEmbeds) attachmentUrl = imageFromEmbeds;
    else if (imageFromText) attachmentUrl = imageFromText;

    // Early fetch to know if we can re-upload (avoids broken embed image)
    let earlyFiles: AttachmentBuilder[] | undefined;
    let earlyDisplayUrl: string | null | undefined = attachmentUrl ?? undefined;
    let canReupload = false;
    if (attachmentUrl) {
      const earlyFetched = await tryFetchAfkFile(attachmentUrl);
      if (earlyFetched) {
        earlyFiles = [earlyFetched];
        const fname = (earlyFetched as unknown as { name?: string }).name ?? `afk-${Date.now()}.gif`;
        earlyDisplayUrl = `attachment://${fname}`;
        canReupload = true;
      } else if (attachmentUrl === imageFromText || attachmentUrl === imageFromEmbeds) {
        earlyDisplayUrl = undefined;
        canReupload = false;
      }
    }

    let finalMessage = afkText.trim() || 'AFK';
    if (canReupload && imageFromText && finalMessage.includes(imageFromText)) {
      finalMessage = finalMessage.replace(imageFromText, '').trim() || 'AFK';
      finalMessage = finalMessage.replace(/\s{2,}/g, ' ').trim() || 'AFK';
    } else if (canReupload && imageFromEmbeds && finalMessage.includes(afkText)) {
      // For tenor/giphy page URLs, the embed's direct media URL is different from the pasted page URL
      // Strip the original pasted URL
      finalMessage = finalMessage.replace(afkText, '').trim() || 'AFK';
      finalMessage = finalMessage.replace(/\s{2,}/g, ' ').trim() || 'AFK';
    }
    // Bare filename without https (e.g., "10E0677E...gif") — hide it if we have a file or not
    if (/^[a-f0-9-]{20,}\.(gif|png|jpg|jpeg|webp)$/i.test(finalMessage.trim())) {
      // If we have an attachment, hide filename, else also hide
      finalMessage = 'AFK';
    }
    if (finalMessage.length > MAX_AFK_MESSAGE_LENGTH) {
      await message.reply(`AFK message too long (max ${MAX_AFK_MESSAGE_LENGTH}).`);
      return;
    }

    // Fix double AFK: if already AFK and same content, don't reset timer
    const existingPrefix = await this.container.afk.fetch(guild.id, finalTargetId);
    if (existingPrefix) {
      const existingAttach = existingPrefix.attachmentUrl ?? null;
      const resolvedNewAttach = attachmentUrl === undefined ? existingAttach : attachmentUrl;
      const isSameMessage = existingPrefix.message === finalMessage;
      const isSameAttach = resolvedNewAttach === existingAttach;
      const isBareAfk =
        !imageFromAttachments &&
        !imageFromText &&
        !imageFromEmbeds &&
        (afkText.trim() === '' || afkText.trim().toLowerCase() === 'afk');
      if (
        (isSameMessage && isSameAttach) ||
        (isBareAfk && !imageFromAttachments && !imageFromText && !imageFromEmbeds)
      ) {
        const ts = Math.floor(new Date(existingPrefix.setAt).getTime() / 1000);
        await message.reply(
          `You're already AFK: ${existingPrefix.message}${existingAttach ? ' · ' + getEmoji('paperclip') : ''} · <t:${ts}:R>`
        );
        return;
      }
    }

    await this.container.afk.set({ guildId: guild.id, userId: finalTargetId, message: finalMessage, attachmentUrl });

    const stored = await this.container.afk.fetch(guild.id, finalTargetId);
    let finalAttach: string | null = stored?.attachmentUrl ?? attachmentUrl ?? null;

    // Use early fetched file if available, otherwise try to fetch stored (for keeping existing)
    let files: AttachmentBuilder[] | undefined = earlyFiles;
    let displayUrl: string | null | undefined = earlyDisplayUrl ?? finalAttach ?? undefined;
    if (!files && finalAttach) {
      if (finalAttach !== attachmentUrl) {
        const fetched = await tryFetchAfkFile(finalAttach);
        if (fetched) {
          files = [fetched];
          const fname = (fetched as unknown as { name?: string }).name ?? `afk-${Date.now()}.gif`;
          displayUrl = `attachment://${fname}`;
        } else {
          // Stored is 404 — hide broken gallery
          displayUrl = undefined;
        }
      } else if (!canReupload) {
        // Pasted URL that failed, hide broken gallery
        displayUrl = undefined;
        files = undefined;
      }
    }

    const isOther = finalTargetId !== message.author.id;
    if (isOther) {
      await message.reply(
        `Set AFK for ${finalTargetTag}: ${finalMessage}${displayUrl ? ' · ' + getEmoji('paperclip') : ''}`
      );
      return;
    }

    const payload = buildAfkSetContainer({
      userTag: finalTargetTag,
      userId: finalTargetId,
      message: finalMessage,
      attachmentUrl: displayUrl ?? undefined,
      guildName: guild.name
    });
    if (files) {
      await message.reply({ ...payload, files } as never);
    } else {
      await message.reply(payload as never);
    }
  }

  private extractId(input: string): string | null {
    const mentionMatch = /^(?:<@!?)(\d+)>$/.exec(input.trim());
    if (mentionMatch) return mentionMatch[1]!;
    return /^\d{17,20}$/.test(input.trim()) ? input.trim() : null;
  }
}
