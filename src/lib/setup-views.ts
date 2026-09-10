import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} from 'discord.js';

import { getEmoji, type EmojiKey } from '../config/emojis.js';
import { theme } from '../config/theme.js';

export const SETUP_ACCENT = theme.colors.primary;
const SETUP_ACCENT_DONE = theme.colors.success;

export const SETUP_LOG_TYPES = [
  'audit',
  'moderation',
  'administrative',
  'message',
  'reaction',
  'emoji',
  'channel',
  'member',
  'cases',
  'voice'
] as const;

export type SetupLogType = (typeof SETUP_LOG_TYPES)[number];

export interface SetupConfigView {
  logChannels?: Partial<Record<string, string>>;
}

export const formatLogType = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

/** Per-type icon + helper copy — keeps dashboard + selects scannable. */
const LOG_META: Record<SetupLogType, { emoji: EmojiKey; blurb: string }> = {
  audit: { emoji: 'audit', blurb: 'Server, role & settings changes' },
  moderation: { emoji: 'security', blurb: 'Bans, kicks, timeouts' },
  administrative: { emoji: 'settings', blurb: 'Admin actions & config' },
  message: { emoji: 'message', blurb: 'Edits & deletes' },
  reaction: { emoji: 'reaction', blurb: 'Reaction adds & removes' },
  emoji: { emoji: 'emoji', blurb: 'Emoji & sticker changes' },
  channel: { emoji: 'channel', blurb: 'Channel creates & updates' },
  member: { emoji: 'member', blurb: 'Joins, leaves & updates' },
  cases: { emoji: 'case', blurb: 'Moderation cases' },
  voice: { emoji: 'voice', blurb: 'Voice joins & leaves' }
};

/** discord.js toJSON quirk patch (same as help handler). */
export const patchContainer = (container: ContainerBuilder): ContainerBuilder => {
  try {
    const json = container.toJSON() as { components?: unknown[] };
    if (json.components?.length) {
      (container as unknown as { data: Record<string, unknown> }).data.components = [...json.components];
    }
  } catch {
    // Ignore patch errors — WHY: safe to no-op outside test env
  }
  return container;
};

const divider = (visible: boolean) => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(visible);

const accentFor = (routed: number, total: number) => (total > 0 && routed === total ? SETUP_ACCENT_DONE : SETUP_ACCENT);

/** Plain text header — WHY: Section+Thumbnail blew the guild icon up to half the card. */
const addHeader = (container: ContainerBuilder, title: string, subtitle: string): void => {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${getEmoji('log')} ${title}\n-# ${subtitle}`)
  );
};

const progressBar = (routed: number, total: number, width = 10): string => {
  if (total <= 0) return '';
  const filled = Math.round((routed / total) * width);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, width - filled));
};

export const countRoutedLogs = (config: SetupConfigView): number =>
  SETUP_LOG_TYPES.filter((t) => Boolean(config.logChannels?.[t])).length;

/** Group types sharing one channel so "All → #rules" renders as 1 line, not 10. */
const groupByChannel = (config: SetupConfigView): { channelId: string; types: string[] }[] => {
  const groups = new Map<string, string[]>();
  for (const type of SETUP_LOG_TYPES) {
    const channelId = config.logChannels?.[type];
    if (!channelId) continue;
    const list = groups.get(channelId) ?? [];
    list.push(type);
    groups.set(channelId, list);
  }
  return [...groups.entries()].map(([channelId, types]) => ({ channelId, types }));
};

const unsetTypes = (config: SetupConfigView): string[] => SETUP_LOG_TYPES.filter((t) => !config.logChannels?.[t]);

const typeLabel = (type: string) =>
  `${getEmoji(LOG_META[type as SetupLogType]?.emoji ?? 'log')} ${formatLogType(type)}`;

/** Compact status block: one line per destination + a single muted "not set" line. */
const statusBlock = (config: SetupConfigView): string => {
  const routed = countRoutedLogs(config);
  if (routed === 0)
    return 'No routes yet.\n\nPick **Route logs** below to get started — or route **All** to send everything to one channel.';
  const groups = groupByChannel(config);
  const lines = groups.map(({ channelId, types }) => {
    const names = types.map((t) => typeLabel(t)).join(' · ');
    return `<#${channelId}>\n${names}`;
  });
  const unset = unsetTypes(config);
  if (unset.length > 0) {
    const names = unset.map((t) => formatLogType(t)).join(', ');
    lines.push(`-# ○ Not set: ${names}`);
  }
  return lines.join('\n\n');
};

/** Dashboard nav: primary text action + single-glyph icon buttons. */
const dashboardRow = (requesterId: string, routed: number) => {
  const route = new ButtonBuilder()
    .setCustomId(`setup:route:${requesterId}`)
    .setLabel('Route logs')
    .setStyle(ButtonStyle.Primary);
  const clear = new ButtonBuilder()
    .setCustomId(`setup:clear:${requesterId}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji(getEmoji('trash'))
    .setDisabled(routed === 0);
  const close = new ButtonBuilder()
    .setCustomId(`setup:close:${requesterId}`)
    .setLabel('×')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(route, clear, close);
};

/** Sub-panel nav: ‹ back + × close — single glyphs, same as help paginator. */
const backRow = (requesterId: string, backTo: 'home' | 'route') => {
  const back = new ButtonBuilder()
    .setCustomId(backTo === 'home' ? `setup:home:${requesterId}` : `setup:route:${requesterId}`)
    .setLabel('‹')
    .setStyle(ButtonStyle.Secondary);
  const close = new ButtonBuilder()
    .setCustomId(`setup:close:${requesterId}`)
    .setLabel('×')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(back, close);
};

export const buildLoggingDashboard = (
  config: SetupConfigView,
  guildName: string,
  requesterId: string
): ContainerBuilder => {
  const routed = countRoutedLogs(config);
  const total = SETUP_LOG_TYPES.length;
  const container = new ContainerBuilder().setAccentColor(accentFor(routed, total));

  const headline =
    routed === total
      ? `All ${total} log types routed`
      : routed === 0
        ? 'Not configured yet'
        : `${routed} of ${total} routed · ${progressBar(routed, total)}`;
  addHeader(container, 'Logging setup', `${guildName.slice(0, 38)} · ${headline}`);
  container.addSeparatorComponents(divider(true));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusBlock(config)));
  container.addSeparatorComponents(divider(false));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Route logs to assign channels · All sends everything to one channel.')
  );
  container.addActionRowComponents(dashboardRow(requesterId, routed) as never);
  return patchContainer(container);
};

export const buildRoutePanel = (config: SetupConfigView, requesterId: string): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(SETUP_ACCENT);

  addHeader(container, 'Route logs', 'Step 1 of 2 · pick what to route');
  container.addSeparatorComponents(divider(true));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`setup:route:type:${requesterId}`)
    .setPlaceholder('Pick a log type (or All)')
    .setOptions([
      {
        label: 'All logs → one channel',
        value: 'all',
        description: 'Route every type at once',
        emoji: getEmoji('log')
      },
      ...SETUP_LOG_TYPES.map((type) => {
        const isSet = Boolean(config.logChannels?.[type]);
        return {
          label: `${formatLogType(type)}${isSet ? ' ✓' : ''}`,
          value: type,
          description: isSet ? `${LOG_META[type].blurb} · set, pick to move` : LOG_META[type].blurb,
          emoji: getEmoji(LOG_META[type].emoji)
        };
      })
    ]);
  container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) as never);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# ✓ means already routed — picking it lets you move it.')
  );
  container.addSeparatorComponents(divider(false));

  container.addActionRowComponents(backRow(requesterId, 'home') as never);
  return patchContainer(container);
};

export const buildRouteChannelPicker = (type: string, requesterId: string): ContainerBuilder => {
  const label = type === 'all' ? 'All logs' : formatLogType(type);
  const container = new ContainerBuilder().setAccentColor(SETUP_ACCENT);

  addHeader(container, 'Route logs', `**${label}** · Step 2 of 2 · pick the channel`);
  container.addSeparatorComponents(divider(true));

  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:route:channel:${type}:${requesterId}`)
    .setPlaceholder(`Channel for ${label}`)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  container.addActionRowComponents(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select) as never);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# The bot needs Send Messages in that channel.')
  );
  container.addSeparatorComponents(divider(false));

  container.addActionRowComponents(backRow(requesterId, 'route') as never);
  return patchContainer(container);
};

export const buildClearPanel = (config: SetupConfigView, requesterId: string): ContainerBuilder => {
  const set = SETUP_LOG_TYPES.filter((t) => Boolean(config.logChannels?.[t]));
  const container = new ContainerBuilder().setAccentColor(SETUP_ACCENT);

  addHeader(container, 'Clear routes', set.length === 0 ? 'Nothing to clear' : 'Pick what to stop logging');
  container.addSeparatorComponents(divider(true));

  if (set.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('All logging is already off — nothing to clear.')
    );
  } else {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`setup:clear:type:${requesterId}`)
      .setPlaceholder('Pick a route to clear')
      .setOptions([
        { label: 'Everything', value: 'all', description: 'Stop all logging', emoji: getEmoji('log') },
        ...set.map((type) => ({
          label: formatLogType(type),
          value: type,
          description: `Stop ${LOG_META[type].blurb.toLowerCase()}`,
          emoji: getEmoji(LOG_META[type].emoji)
        }))
      ]);
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) as never);
    container.addSeparatorComponents(divider(false));
  }

  container.addActionRowComponents(backRow(requesterId, 'home') as never);
  return patchContainer(container);
};
