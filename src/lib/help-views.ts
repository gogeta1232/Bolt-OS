import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} from 'discord.js';
import { type Command as SapphireCommand } from '@sapphire/framework';

import { getEmoji, type EmojiKey } from '../config/emojis.js';
import { theme } from '../config/theme.js';
import { AdminCommand } from './structures/AdminCommand.js';

export const HELP_ACCENT = theme.colors.primary;
export const HELP_PAGE_SIZE = 6;

export interface HelpEntry {
  name: string;
  description: string;
  aliases: string[];
  admin: boolean;
}

export interface HelpModuleView {
  id: string;
  label: string;
  icon: EmojiKey;
  description: string;
  entries: HelpEntry[];
}

interface ModuleMeta {
  label: string;
  icon: EmojiKey;
  description: string;
}

/** Curated display order + copy. Unknown folders auto-appear with fallback meta. */
const MODULE_META: Record<string, ModuleMeta> = {
  utility: { label: 'Utility', icon: 'slash', description: 'Everyday tools — info, fun and helpers.' },
  moderation: {
    label: 'Moderation',
    icon: 'security',
    description: 'Keep the server safe — bans, mutes, cases and cleanup.'
  },
  admin: {
    label: 'Administration',
    icon: 'settings',
    description: 'Server setup — prefixes, logging, roles and automation.'
  }
};

const MODULE_ORDER = ['utility', 'moderation', 'admin'];

const metaFor = (id: string): ModuleMeta =>
  MODULE_META[id] ?? {
    label: id.charAt(0).toUpperCase() + id.slice(1),
    icon: 'slash',
    description: `More commands.`
  };

/** discord.js toJSON quirk patch (same as setup wizard). */
export const patchHelpContainer = (container: ContainerBuilder): ContainerBuilder => {
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

/**
 * Dynamic catalog straight from the command store.
 * WHY: new command files appear automatically with their live description —
 * no static list to update, ever.
 */
export const buildHelpCatalog = (commands: Iterable<SapphireCommand>, isDeveloper = false): HelpModuleView[] => {
  const byId = new Map<string, HelpEntry[]>();
  for (const cmd of commands) {
    if (!cmd.enabled) continue;
    const cats = (cmd.fullCategory ?? []).map((c) => c.toLowerCase());
    if (cats.includes('developer') && !isDeveloper) continue;
    const moduleId = cats[0] ?? 'other';
    const list = byId.get(moduleId) ?? [];
    list.push({
      name: cmd.name,
      description: cmd.description?.length ? cmd.description : 'No description provided.',
      aliases: [...(cmd.aliases ?? [])],
      admin: cmd instanceof AdminCommand
    });
    byId.set(moduleId, list);
  }
  const orderOf = (id: string) => {
    const i = MODULE_ORDER.indexOf(id);
    return i === -1 ? MODULE_ORDER.length : i;
  };
  return [...byId.entries()]
    .map(([id, entries]) => ({
      id,
      ...metaFor(id),
      entries: entries.sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.label.localeCompare(b.label));
};

export const countHelpCommands = (modules: HelpModuleView[]): number =>
  modules.reduce((n, m) => n + m.entries.length, 0);

export const findHelpCommand = (commands: Iterable<SapphireCommand>, query: string): SapphireCommand | undefined => {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  for (const cmd of commands) {
    if (cmd.name.toLowerCase() === q) return cmd;
    if (cmd.aliases?.some((a) => a.toLowerCase() === q)) return cmd;
  }
  return undefined;
};

const moduleIndex = (modules: HelpModuleView[], moduleId: string): number =>
  Math.max(
    0,
    modules.findIndex((m) => m.id === moduleId)
  );

const dashboardRow = (moduleId: string, page: number, totalPages: number, requesterId: string) => {
  const home = new ButtonBuilder()
    .setCustomId(`help:home:${requesterId}`)
    .setLabel('⌂')
    .setStyle(ButtonStyle.Secondary);
  const prev = new ButtonBuilder()
    .setCustomId(`help:prev:${moduleId}:${page}:${requesterId}`)
    .setLabel('‹')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);
  const next = new ButtonBuilder()
    .setCustomId(`help:next:${moduleId}:${page}:${requesterId}`)
    .setLabel('›')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);
  const close = new ButtonBuilder()
    .setCustomId(`help:close:${moduleId}:${page}:${requesterId}`)
    .setLabel('×')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(home, prev, next, close);
};

const moduleSelectRow = (modules: HelpModuleView[], currentId: string, requesterId: string) => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`help:select:${requesterId}`)
    .setPlaceholder('Browse a module')
    .setOptions(
      modules.map((m) => ({
        label: `${m.label} (${m.entries.length})`,
        value: m.id,
        description: m.description.slice(0, 100),
        default: m.id === currentId,
        emoji: getEmoji(m.icon)
      }))
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

/** Home dashboard — one Section per module with its own View button. */
export const buildHelpHome = (modules: HelpModuleView[], prefix: string, requesterId: string): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(HELP_ACCENT);
  const total = countHelpCommands(modules);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${getEmoji('info')} Help Desk\n-# ${total} commands · ${modules.length} modules · pick one to explore`
    )
  );
  container.addSeparatorComponents(divider(true));

  if (modules.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`No commands available right now.`));
    return patchHelpContainer(container);
  }

  for (const mod of modules) {
    const adminCount = mod.entries.filter((e) => e.admin).length;
    const lockNote = adminCount > 0 ? ` · ${adminCount} ${getEmoji('lockIcon')}` : ``;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${getEmoji(mod.icon)} ${mod.label}**\n-# ${mod.description}\n-# ${mod.entries.length} commands${lockNote}`
          )
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`help:category:${mod.id}:${requesterId}`)
            .setLabel('View')
            .setStyle(ButtonStyle.Secondary)
        )
    );
  }

  container.addSeparatorComponents(divider(false));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${getEmoji('lockIcon')} needs Administrator · \`${prefix}help <command>\` jumps straight to details`
    )
  );
  const close = new ButtonBuilder()
    .setCustomId(`help:close:home:0:${requesterId}`)
    .setLabel('×')
    .setStyle(ButtonStyle.Secondary);
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(close) as never);
  return patchHelpContainer(container);
};

export const buildHelpPanel = (
  modules: HelpModuleView[],
  moduleId: string,
  page: number,
  prefix: string,
  requesterId: string
): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(HELP_ACCENT);
  const total = countHelpCommands(modules);

  if (modules.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${getEmoji('info')} Help\n-# No commands available right now.`)
    );
    return patchHelpContainer(container);
  }

  const mod = modules.find((m) => m.id === moduleId) ?? modules[0]!;
  const totalPages = Math.max(1, Math.ceil(mod.entries.length / HELP_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = mod.entries.slice(safePage * HELP_PAGE_SIZE, (safePage + 1) * HELP_PAGE_SIZE);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${getEmoji('info')} Help\n-# ${total} commands across ${modules.length} modules · \`${prefix}help <command>\` for details`
    )
  );
  container.addSeparatorComponents(divider(true));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ${getEmoji(mod.icon)} ${mod.label}\n-# ${mod.description}`)
  );
  container.addSeparatorComponents(divider(false));

  // Airy rows: command on its own line, description in muted subtext below.
  const rows = slice.map(
    (e) => `\`${prefix}${e.name}\`${e.admin ? ` ${getEmoji('lockIcon')}` : ''}\n-# ${e.description}`
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows.join('\n\n')));
  container.addSeparatorComponents(divider(false));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${mod.label} ${moduleIndex(modules, mod.id) + 1}/${modules.length} · Page ${safePage + 1}/${totalPages} · ${getEmoji('lockIcon')} admin only`
    )
  );
  container.addActionRowComponents(moduleSelectRow(modules, mod.id, requesterId) as never);
  container.addActionRowComponents(dashboardRow(mod.id, safePage, totalPages, requesterId) as never);
  return patchHelpContainer(container);
};

/** Detail card for one command — all live data from the store. */
export const buildCommandPanel = (
  cmd: SapphireCommand,
  prefix: string,
  moduleLabel?: string,
  nav?: { moduleId: string; requesterId: string }
): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(HELP_ACCENT);
  const description = cmd.description?.length ? cmd.description : 'No description provided.';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## \`${prefix}${cmd.name}\`\n-# ${description}`)
  );
  container.addSeparatorComponents(divider(false));
  const meta: string[] = [];
  if (cmd.aliases?.length) meta.push(`**Aliases:** ${cmd.aliases.map((a) => `\`${a}\``).join(' · ')}`);
  meta.push(`**Module:** ${moduleLabel ?? cmd.fullCategory?.join(' › ') ?? 'General'}`);
  if (cmd instanceof AdminCommand) meta.push(`**Requires:** ${getEmoji('lockIcon')} Administrator`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta.join('\n')));
  container.addSeparatorComponents(divider(false));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# \`${prefix}help\` to browse everything`));
  if (nav) {
    const back = new ButtonBuilder()
      .setCustomId(`help:category:${nav.moduleId}:${nav.requesterId}`)
      .setLabel('‹')
      .setStyle(ButtonStyle.Secondary);
    const close = new ButtonBuilder()
      .setCustomId(`help:close:${nav.moduleId}:0:${nav.requesterId}`)
      .setLabel('×')
      .setStyle(ButtonStyle.Secondary);
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(back, close) as never);
  }
  return patchHelpContainer(container);
};

export const buildHelpClosed = (): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(HELP_ACCENT);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${getEmoji('info')} Help\n-# Closed. Run \`help\` again to reopen.`)
  );
  container.addSeparatorComponents(divider(true));
  return patchHelpContainer(container);
};

export const HELP_COMPONENTS_FLAGS = MessageFlags.IsComponentsV2;
