import type { MessageMentionOptions } from 'discord.js';

/** Keep Discord mention labels visible without notifying their recipients. */
export const NO_MENTIONS: MessageMentionOptions = {
  parse: [],
  users: [],
  roles: [],
  repliedUser: false
};
