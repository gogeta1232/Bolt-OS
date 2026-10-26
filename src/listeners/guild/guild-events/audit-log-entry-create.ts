import { Events, Listener } from '@sapphire/framework';
import type { Guild, GuildAuditLogsEntry } from 'discord.js';

import { formatAuditEntry } from '../../../lib/audit-log.js';

export class AuditLogEntryCreateListener extends Listener<typeof Events.GuildAuditLogEntryCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildAuditLogEntryCreate });
  }

  public async run(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    const { description, context } = formatAuditEntry(entry);
    await this.container.logging.sendAuditLog(guild, description, context);
  }
}
