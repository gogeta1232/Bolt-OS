import { AuditLogEvent, escapeMarkdown, type GuildAuditLogsEntry } from 'discord.js';

import type { LogContext } from '../config/logging.js';

/** Use the executor on this exact entry, never the latest entry for a target. */
export function formatAuditEntry(entry: GuildAuditLogsEntry): { description: string; context: LogContext } {
  const action = AuditLogEvent[entry.action]?.replace(/([a-z])([A-Z])/g, '$1 $2') ?? `Action ${entry.action}`;
  const lines = [
    `**Action:** ${action}`,
    `**Performed by:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown (not provided by Discord)'}`
  ];
  if (entry.targetId) lines.push(`**Target (${entry.targetType}):** \`${entry.targetId}\``);
  const keys = [...new Set(entry.changes.map((change) => change.key))];
  if (keys.length > 0) {
    // Arbitrary change values can contain credentials (for example webhook tokens).
    lines.push(
      `**Changed:** ${keys
        .slice(0, 12)
        .map((key) => escapeMarkdown(key.slice(0, 80)))
        .join(', ')}`
    );
    if (keys.length > 12) lines.push(`-# +${keys.length - 12} more changed fields`);
  }
  return {
    description: lines.join('\n'),
    context: {
      subjectId: entry.id,
      timestamp: entry.createdTimestamp,
      reason: entry.reason ? escapeMarkdown(entry.reason.slice(0, 500)) : null
    }
  };
}
