import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { AuditLogEvent, Guild, GuildAuditLogsEntry, User } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { buildLogV2Container } from '../../src/config/logging.js';
import { formatAuditEntry } from '../../src/lib/audit-log.js';
import { AuditLogEntryCreateListener } from '../../src/listeners/guild/guild-events/audit-log-entry-create.js';
import { loggingService } from '../../src/services/core/logging-service.js';

const clients: SapphireClient[] = [];
const fixture = () => {
  const client = new SapphireClient({ intents: [], baseUserDirectory: null });
  clients.push(client);
  const guild = new Guild(client, { id: '100000000000000001', name: 'Test' });
  const entry = new GuildAuditLogsEntry(guild, {
    id: '140000000000000001',
    action_type: AuditLogEvent.MemberUpdate,
    user_id: '200000000000000001',
    target_id: '300000000000000001',
    reason: 'Spam',
    changes: [{ key: 'communication_disabled_until', new_value: '2026-10-17T00:00:00Z' }]
  });
  container.logging = loggingService;
  const send = vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
  const listener = new AuditLogEntryCreateListener({
    name: 'audit-log-entry-create',
    root: process.cwd(),
    path: 'listeners/guild/guild-events/audit-log-entry-create.ts',
    store: client.stores.get('listeners')
  });
  return { client, guild, entry, send, listener };
};
let current: ReturnType<typeof fixture>;
beforeEach(() => {
  current = fixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.destroy()));
});

test('forwards external Discord actions with the exact executor even when the user is uncached', async () => {
  const { guild, entry, send, listener } = current;
  expect(entry.executor).toBeNull();
  await listener.run(entry, guild);
  expect(send).toHaveBeenCalledOnce();
  const call = send.mock.calls[0];
  expect(call?.[0]).toBe(guild);
  expect(call?.[1]).toContain('Member Update');
  expect(call?.[1]).toContain('**Performed by:** <@200000000000000001>');
  expect(call?.[1]).toContain('300000000000000001');
  expect(call?.[2]).toMatchObject({ subjectId: entry.id, timestamp: entry.createdTimestamp, reason: 'Spam' });
});

test('does not substitute a target or bot for an unknown executor', () => {
  const { entry } = current;
  entry.executorId = null;
  expect(formatAuditEntry(entry).description).toContain('**Performed by:** Unknown');
});

test('never dumps arbitrary change values into the audit channel', () => {
  const { entry } = current;
  entry.changes = [{ key: 'token', new: 'sensitive-fixture-value' }];
  const result = formatAuditEntry(entry);
  expect(result.description).toContain('token');
  expect(result.description).not.toContain('sensitive-fixture-value');
});

test('a target in the log header no longer hides the moderator', () => {
  const { client } = current;
  const actor = new User(client, { id: '200000000000000001', username: 'Moderator' });
  const target = new User(client, { id: '300000000000000001', username: 'Member' });
  const result = buildLogV2Container('moderation', 'Member timed out', { actor, target });
  expect(JSON.stringify(result.components[0].toJSON())).toContain(`<@${target.id}> • by <@${actor.id}>`);
});
