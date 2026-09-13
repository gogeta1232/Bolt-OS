import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';

import { theme } from '../config/theme.js';
import { getEmoji } from '../config/emojis.js';
import { patchHelpContainer } from './help-views.js';

type AccentKey = keyof typeof theme.colors;

export type AccessTier = 'owner' | 'native' | 'admin-role' | 'fake' | 'mod' | 'member';

export interface AccessInput {
  tag: string;
  userId: string;
  isOwner: boolean;
  /** Held gate perms, subset of ['Administrator', 'ManageGuild']. */
  nativeKeys: string[];
  /** Resolved names of matched bot admin roles. */
  botRoleNames: string[];
  /** Resolved names of matched bot mod roles. */
  modRoleNames: string[];
  /** Effective granular fake permissions for this member. */
  fakePerms?: string[];
  /** Resolved names of matched fake-permission roles. */
  fakeRoleNames?: string[];
  /** Whether the guild configured any bot admin roles at all. */
  botAdminConfigured: boolean;
  /** Whether any fake-permission roles exist at all. */
  botFakeConfigured?: boolean;
  guildPrefix: string;
  isSelf: boolean;
}

export interface AccessView {
  tier: AccessTier;
  accent: AccentKey;
  verdict: string;
  setup: string[];
}

const MAX_NAME_LENGTH = 32;
const MAX_ROLES_SHOWN = 5;

const clean = (value: string): string => value.replace(/`/g, "'").slice(0, MAX_NAME_LENGTH).trim();

/**
 * Resolves which of Bolt's two keys a member holds — pure, no Discord runtime.
 * WHY pure: the tier matrix is the security-critical decision; it gets unit tests,
 * while the command file only translates Discord objects into this input.
 * Hierarchy: owner → native → admin-role → fake (granular) → mod (legacy blanket) → member.
 */
export const describeAccess = (input: AccessInput): AccessView => {
  const who = input.isSelf ? 'You hold' : `${clean(input.tag)} holds`;
  const fakePerms = input.fakePerms ?? [];
  const fakeRoleNames = input.fakeRoleNames ?? [];
  const botFakeConfigured = input.botFakeConfigured ?? false;
  if (input.isOwner) {
    return {
      tier: 'owner',
      accent: 'success',
      verdict: `${who} both keys — server owner, full access.`,
      setup: input.botAdminConfigured
        ? []
        : [`${input.guildPrefix}fadmin @role — hand out a Bolt key without touching Discord permissions.`]
    };
  }
  if (input.nativeKeys.length > 0) {
    return {
      tier: 'native',
      accent: 'warning',
      verdict: `${who} Key I — Discord ${input.nativeKeys.map((k) => `\`${k}\``).join(' + ')}.`,
      setup: input.botAdminConfigured
        ? []
        : [`${input.guildPrefix}fadmin @role — Key II lets moderators act through Bolt only.`]
    };
  }
  if (input.botRoleNames.length > 0) {
    const shown = input.botRoleNames
      .map(clean)
      .filter((n) => n.length > 0)
      .slice(0, MAX_ROLES_SHOWN);
    const extra = input.botRoleNames.length - shown.length;
    const roles = shown.map((n) => `\`${n}\``).join(', ') + (extra > 0 ? ` +${extra} more` : '');
    return {
      tier: 'admin-role',
      accent: 'primary',
      verdict: `${who} Key II — Bolt admin ${shown.length === 1 && extra <= 0 ? 'role' : 'roles'} ${roles}. Full access, can grant mod.`,
      setup: []
    };
  }
  if (fakePerms.includes('Administrator')) {
    const roles =
      fakeRoleNames.length > 0
        ? ` via ${fakeRoleNames
            .map(clean)
            .slice(0, 2)
            .map((n) => `\`${n}\``)
            .join(', ')}`
        : '';
    return {
      tier: 'admin-role',
      accent: 'primary',
      verdict: `${who} Key II — fake Administrator${roles}. Full access, can grant mods.`,
      setup: []
    };
  }
  if (fakePerms.length > 0) {
    const perms = fakePerms
      .map(clean)
      .filter((n) => n.length > 0)
      .slice(0, MAX_ROLES_SHOWN);
    const extra = fakePerms.length - perms.length;
    const permLabel = perms.map((n) => `\`${n}\``).join(' · ') + (extra > 0 ? ` +${extra} more` : '');
    const roles =
      fakeRoleNames.length > 0
        ? ` via ${fakeRoleNames
            .map(clean)
            .slice(0, 2)
            .map((n) => `\`${n}\``)
            .join(', ')}`
        : '';
    return {
      tier: 'fake',
      accent: 'info',
      verdict: `${who} Key II — fake ${permLabel}${roles}. Moderation only, granular — no admin surface.`,
      setup: []
    };
  }
  if (input.modRoleNames.length > 0) {
    const shown = input.modRoleNames
      .map(clean)
      .filter((n) => n.length > 0)
      .slice(0, MAX_ROLES_SHOWN);
    const extra = input.modRoleNames.length - shown.length;
    const roles = shown.map((n) => `\`${n}\``).join(', ') + (extra > 0 ? ` +${extra} more` : '');
    return {
      tier: 'mod',
      accent: 'info',
      verdict: `${who} Key II — Bolt mod ${shown.length === 1 && extra <= 0 ? 'role' : 'roles'} ${roles}. Moderation only, no admin surface, no grants.`,
      setup: []
    };
  }
  return {
    tier: 'member',
    accent: 'danger',
    verdict: `${who} no keys — regular member.`,
    setup: input.botAdminConfigured
      ? [`Ask an admin for a Bolt role, or an owner for \`${input.guildPrefix}fadmin\`.`]
      : botFakeConfigured
        ? [`Ask an admin for a fake role with \`${input.guildPrefix}givepermission add @role <perms>\`.`]
        : [`No Bolt keys exist here yet — the owner starts with \`${input.guildPrefix}fadmin @role\`.`]
  };
};

/**
 * Grant matrix — pure. Owner hands out both keys; admins hand out mod only.
 * Admin can never create another admin: no escalation path by design.
 */
export const canGrantKey = (granter: { isOwner: boolean; isAdmin: boolean }, key: 'admin' | 'mod'): boolean => {
  if (key === 'admin') return granter.isOwner;
  return granter.isOwner || granter.isAdmin;
};

export interface AccessPanelOptions {
  view: AccessView;
  input: AccessInput;
}

/**
 * Sleek V2 access panel — verdict header, both keys, one setup nudge.
 * WHY shared builder: slash + prefix paths render identical output.
 */
export const buildAccessContainer = ({ view, input }: AccessPanelOptions): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(theme.colors[view.accent]);
  const tag = clean(input.tag);
  const sep = (): SeparatorBuilder => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false);
  const text = (content: string): TextDisplayBuilder => new TextDisplayBuilder().setContent(content);

  container.addTextDisplayComponents(text(`**${getEmoji('lock')} │ Access — ${tag}**\n-# ID \`${input.userId}\``));
  container.addSeparatorComponents(sep());
  container.addTextDisplayComponents(text(view.verdict));

  const names = (list: string[]): string =>
    list.length > 0
      ? list
          .map(clean)
          .filter((n) => n.length > 0)
          .slice(0, MAX_ROLES_SHOWN)
          .map((n) => `\`${n}\``)
          .join(', ')
      : '— none';
  const fakePerms = input.fakePerms ?? [];
  const fakeRoleNames = input.fakeRoleNames ?? [];
  const native = input.nativeKeys.length > 0 ? input.nativeKeys.map((k) => `\`${k}\``).join(' · ') : '— none held';
  const fakePermsLabel = fakePerms.length > 0 ? fakePerms.map((k) => `\`${k}\``).join(' · ') : '— none';
  container.addSeparatorComponents(sep());
  container.addTextDisplayComponents(
    text(
      `**Key I — Discord**\n-# ${native}\n**Key II — Bolt admin**\n-# ${names(input.botRoleNames)}\n**Key II — Bolt mod**\n-# ${names(input.modRoleNames)}\n**Key II — Fake perms**\n-# ${fakePermsLabel}${fakeRoleNames.length > 0 ? ` · via ${names(fakeRoleNames)}` : ''}`
    )
  );

  if (view.setup.length > 0) {
    container.addSeparatorComponents(sep());
    container.addTextDisplayComponents(text(`-# ${getEmoji('info')} ${view.setup.join(' ')}`));
  }

  container.addSeparatorComponents(sep());
  container.addTextDisplayComponents(text(`-# Prefix here: \`${input.guildPrefix}\` · slash always works`));

  return patchHelpContainer(container);
};
