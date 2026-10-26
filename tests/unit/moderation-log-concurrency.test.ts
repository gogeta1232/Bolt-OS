import { SapphireClient } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { Guild, GuildMember, Message, TextChannel } from 'discord.js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';

import { KickCommand } from '../../src/commands/moderation/kick.js';
import { SoftbanCommand } from '../../src/commands/moderation/softban.js';
import { loggingService } from '../../src/services/core/logging-service.js';
import { memberResolver } from '../../src/services/core/member-resolver.js';
import { caseService } from '../../src/services/moderation/case-service.js';

const client = new SapphireClient({ intents: [], baseUserDirectory: null });
beforeAll(async () => client.stores.get('arguments').loadAll());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => client.destroy());

test.each([
  ['kick', false],
  ['kick', true],
  ['softban', false],
  ['softban', true]
] as const)('%s overlaps response and persistence safely when case failure is %s', async (name, failCase) => {
  const owner = { id: '123456789012345678', username: 'owner', discriminator: '0', avatar: null };
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test', owner_id: owner.id });
  client.guilds.cache.set(guild.id, guild);
  guild.members.cache.set(owner.id, new GuildMember(client, { user: owner, roles: [] }, guild));
  const target = new GuildMember(
    client,
    { user: { ...owner, id: '123456789012345680', username: 'target' }, roles: [] },
    guild
  );
  guild.members.cache.set(target.id, target);
  vi.spyOn(target, 'kickable', 'get').mockReturnValue(true);
  vi.spyOn(target, 'bannable', 'get').mockReturnValue(true);
  const channel = new TextChannel(guild, { id: '123456789012345681', name: 'test', type: 0 }, client);
  guild.channels.cache.set(channel.id, channel);
  client.channels.cache.set(channel.id, channel);
  const input = `<@${target.id}> reason`;
  const message = new Message(client, {
    id: '123456789012345682',
    guild_id: guild.id,
    channel_id: channel.id,
    author: owner,
    content: `!${name} ${input}`,
    timestamp: new Date(0).toISOString(),
    type: 0,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: []
  });
  let releaseReply: (value: Message) => void = () => undefined;
  const pendingReply = new Promise<Message>((resolve) => {
    releaseReply = resolve;
  });
  const reply = vi.spyOn(message, 'reply').mockResolvedValue(message).mockReturnValueOnce(pendingReply);
  container.memberResolver = memberResolver;
  container.cases = caseService;
  container.logging = loggingService;
  vi.spyOn(memberResolver, 'resolve').mockResolvedValue({ member: target, consumed: 1, confidence: 1 });
  const kick = vi.spyOn(target, 'kick').mockResolvedValue(target);
  const ban = vi.spyOn(guild.members, 'ban').mockResolvedValue(target);
  const unban = vi.spyOn(guild.members, 'unban').mockResolvedValue(target.user);
  const create = vi.spyOn(caseService, 'create').mockImplementation(async (options) => {
    if (name === 'kick') expect(kick).toHaveBeenCalledOnce();
    else {
      expect(ban).toHaveBeenCalledOnce();
      expect(unban).toHaveBeenCalledOnce();
      expect(ban.mock.invocationCallOrder[0]).toBeLessThan(unban.mock.invocationCallOrder[0] ?? 0);
    }
    if (failCase) throw new Error('Case write failed');
    return { ...options, caseId: 1, evidence: [], createdAt: new Date(0), updatedAt: new Date(0) };
  });
  let releaseLog: () => void = () => undefined;
  const pendingLog = new Promise<void>((resolve) => {
    releaseLog = resolve;
  });
  const moderation = vi.spyOn(loggingService, 'sendModerationLog').mockReturnValue(pendingLog);
  const caseLog = vi.spyOn(loggingService, 'sendCaseLog').mockResolvedValue(undefined);
  const context = {
    name,
    root: process.cwd(),
    path: `commands/moderation/${name}.ts`,
    store: client.stores.get('commands')
  };
  const command = name === 'kick' ? new KickCommand(context) : new SoftbanCommand(context);
  const args = await command.messagePreParse(message, input, { commandName: name, prefix: '!', commandPrefix: '!' });
  const running = command.messageRun(message, args);
  try {
    // Persistence must start after the action, without waiting for response delivery.
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(reply).toHaveBeenCalledOnce();
    releaseReply(message);
    await running;
    expect(create).toHaveBeenCalledOnce();
    if (failCase) {
      expect(reply).toHaveBeenCalledTimes(2);
      expect(moderation).not.toHaveBeenCalled();
      expect(caseLog).not.toHaveBeenCalled();
      return;
    }
    expect(moderation).toHaveBeenCalledOnce();
    // Case logging must start while the moderation log is still pending.
    expect(caseLog).toHaveBeenCalledOnce();
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(caseLog.mock.invocationCallOrder[0] ?? 0);
  } finally {
    releaseReply(message);
    releaseLog();
    await running;
    await pendingLog;
  }
});
