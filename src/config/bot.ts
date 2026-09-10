import { ActivityType, GatewayIntentBits, Partials, type PresenceData } from 'discord.js';

import { env } from './env.js';

const presence = {
  status: 'online',
  activities: [
    {
      name: 'Stalking me huh?⚡',
      type: ActivityType.Playing
    }
  ]
} satisfies PresenceData;

const clientOptions = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers
  ],
  partials: [Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.Channel],
  loadMessageCommandListeners: true,
  defaultPrefix: env.DEFAULT_PREFIX,
  caseInsensitiveCommands: true,
  caseInsensitivePrefixes: true
} as const;

export const botConfig = {
  clientOptions,
  presence
} as const;
