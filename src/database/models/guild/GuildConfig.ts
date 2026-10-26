import { Schema, model } from 'mongoose';

import { DEFAULT_GREET_DURATION_MS, MAX_GREET_DURATION_MS, MIN_GREET_DURATION_MS } from '../../../lib/greeting.js';

export interface GuildConfigDocument {
  guildId: string;
  prefix: string;
  noPrefixMode?: boolean;
  logChannels: {
    audit?: string;
    moderation?: string;
    administrative?: string;
    message?: string;
    reaction?: string;
    emoji?: string;
    channel?: string;
    member?: string;
    cases?: string;
    voice?: string;
    invites?: string;
  };
  adminRoleIds: string[];
  /** Bot-side moderator keys: moderation commands only, never admin surface, never grants. */
  modRoleIds: string[];
  /** Granular fake Discord permissions per role — no real Discord perm is granted. */
  fakePermissions?: Record<string, string[]>;
  mutedRoleId?: string;
  jailRoleId?: string;
  jailChannelId?: string;
  greetChannels?: string[];
  greetMessage?: string;
  greetDurationMs?: number;
}

const GuildConfigSchema = new Schema<GuildConfigDocument>(
  {
    guildId: { type: String, required: true, unique: true },
    prefix: { type: String, default: '!' },
    noPrefixMode: { type: Boolean, default: false },
    logChannels: {
      audit: { type: String, required: false },
      moderation: { type: String, required: false },
      administrative: { type: String, required: false },
      message: { type: String, required: false },
      reaction: { type: String, required: false },
      emoji: { type: String, required: false },
      channel: { type: String, required: false },
      member: { type: String, required: false },
      cases: { type: String, required: false },
      voice: { type: String, required: false },
      invites: { type: String, required: false }
    },
    adminRoleIds: { type: [String], default: [] },
    modRoleIds: { type: [String], default: [] },
    fakePermissions: { type: Schema.Types.Mixed, default: {} },
    mutedRoleId: { type: String, required: false },
    jailRoleId: { type: String, required: false },
    jailChannelId: { type: String, required: false },
    greetChannels: { type: [String], default: [] },
    greetMessage: {
      type: String,
      required: false,
      maxlength: 2_000,
      default: 'Welcome to the server, {{user}}!'
    },
    greetDurationMs: {
      type: Number,
      default: DEFAULT_GREET_DURATION_MS,
      min: MIN_GREET_DURATION_MS,
      max: MAX_GREET_DURATION_MS,
      validate: Number.isSafeInteger
    }
  },
  {
    strict: true,
    minimize: false
  }
);

export const GuildConfigModel = model<GuildConfigDocument>('GuildConfig', GuildConfigSchema);
