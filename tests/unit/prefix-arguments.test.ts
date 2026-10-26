import { SapphireClient, type Command } from '@sapphire/framework';
import { container } from '@sapphire/pieces';
import { Guild, GuildMember, Message, Role, TextChannel } from 'discord.js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';

import { MemberResolvedArgument } from '../../src/arguments/memberResolved.js';
import { FadminCommand } from '../../src/commands/permissions/fadmin.js';
import { FmodCommand } from '../../src/commands/permissions/fmod.js';
import { RoleInfoCommand } from '../../src/commands/utility/roleinfo.js';
import { UserBannerCommand } from '../../src/commands/utility/userbanner.js';
import { UserInfoCommand } from '../../src/commands/utility/userinfo.js';
import { memberResolver } from '../../src/services/core/member-resolver.js';
import { configService } from '../../src/services/core/config-service.js';
import { loggingService } from '../../src/services/core/logging-service.js';

const client = new SapphireClient({ intents: [], baseUserDirectory: null });
beforeAll(async () => {
  const argumentsStore = client.stores.get('arguments');
  await argumentsStore.loadAll();
  await argumentsStore.insert(
    new MemberResolvedArgument({
      name: 'memberResolved',
      root: process.cwd(),
      path: 'arguments/memberResolved.ts',
      store: argumentsStore
    })
  );
  container.memberResolver = memberResolver;
});
afterEach(() => {
  vi.restoreAllMocks();
  memberResolver.clear();
});
afterAll(async () => {
  await client.destroy();
});

const setup = (): { message: Message; target: GuildMember; channel: TextChannel; role: Role } => {
  const guild = new Guild(client, { id: '123456789012345679', name: 'Test' });
  client.guilds.cache.set(guild.id, guild);
  const role = new Role(
    client,
    {
      id: guild.id,
      name: '@everyone',
      permissions: '0',
      position: 0,
      color: 0,
      colors: { primary_color: 0, secondary_color: null, tertiary_color: null }
    },
    guild
  );
  guild.roles.cache.set(role.id, role);
  const user = {
    id: '123456789012345680',
    username: 'target',
    discriminator: '0',
    avatar: null,
    banner: 'fixture',
    public_flags: 0
  };
  const target = new GuildMember(
    client,
    { user, roles: [], nick: 'Thunder Wolf', joined_at: new Date(0).toISOString() },
    guild
  );
  guild.members.cache.set(target.id, target);
  const channel = new TextChannel(guild, { id: '123456789012345681', name: 'general', type: 0 }, client);
  client.channels.cache.set(channel.id, channel);
  guild.channels.cache.set(channel.id, channel);
  const message = new Message(client, {
    id: '123456789012345682',
    channel_id: channel.id,
    guild_id: guild.id,
    author: user,
    content: '',
    timestamp: new Date(0).toISOString(),
    type: 0,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: []
  });
  vi.spyOn(target.user, 'fetch').mockResolvedValue(target.user);
  vi.spyOn(channel, 'send').mockResolvedValue(message);
  return { message, target, channel, role };
};
const context = (name: string): Command.LoaderContext => ({
  name,
  root: process.cwd(),
  path: `commands/utility/${name}.ts`,
  store: client.stores.get('commands')
});

test.each(['userinfo', 'userbanner'] as const)('%s resolves a successful member argument once', async (name) => {
  const { message, target } = setup();
  const command = name === 'userinfo' ? new UserInfoCommand(context(name)) : new UserBannerCommand(context(name));
  const resolve = vi.spyOn(memberResolver, 'resolve');
  const args = await command.messagePreParse(message, `<@${target.id}>`, {
    commandName: name,
    prefix: '!',
    commandPrefix: '!'
  });
  await command.messageRun(message, args);
  expect(resolve).toHaveBeenCalledOnce();
  expect(args.finished).toBe(true);
});

test('roleinfo resolves a role argument once', async () => {
  const { message, role } = setup();
  const command = new RoleInfoCommand(context('roleinfo'));
  const fetch = vi.spyOn(role.guild.roles, 'fetch').mockResolvedValue(role);
  const args = await command.messagePreParse(message, `<@&${role.id}>`, {
    commandName: 'roleinfo',
    prefix: '!',
    commandPrefix: '!'
  });
  await command.messageRun(message, args);
  expect(fetch).toHaveBeenCalledOnce();
  expect(args.finished).toBe(true);
});

test.each([
  ['fadmin', false],
  ['fadmin', true],
  ['fmod', false],
  ['fmod', true]
] as const)('%s reuses its resolved role when existing grant is %s', async (name, granted) => {
  const { message, target, role, channel } = setup();
  target.guild.ownerId = target.id;
  container.config = configService;
  container.logging = loggingService;
  const config = {
    guildId: target.guild.id,
    prefix: '!',
    logChannels: {},
    adminRoleIds: name === 'fadmin' && granted ? [role.id] : [],
    modRoleIds: name === 'fmod' && granted ? [role.id] : []
  };
  vi.spyOn(configService, 'fetch').mockResolvedValue(config);
  const set = vi.spyOn(configService, 'set').mockResolvedValue(config);
  const audit = vi.spyOn(loggingService, 'sendAuditLog').mockResolvedValue(undefined);
  const fetch = vi.spyOn(target.guild.roles, 'fetch').mockResolvedValue(role);
  const command = name === 'fadmin' ? new FadminCommand(context(name)) : new FmodCommand(context(name));
  const args = await command.messagePreParse(message, `<@&${role.id}>`, {
    commandName: name,
    prefix: '!',
    commandPrefix: '!'
  });
  await command.messageRun(message, args);
  expect(fetch).toHaveBeenCalledOnce();
  expect(set).toHaveBeenCalledWith(target.guild.id, {
    [name === 'fadmin' ? 'adminRoleIds' : 'modRoleIds']: granted ? [] : [role.id]
  });
  expect(audit).toHaveBeenCalledOnce();
  expect(channel.send).toHaveBeenCalledOnce();
});

test('failed member conversion preserves multi-word fallback input', async () => {
  const { message, target, channel } = setup();
  const other = new GuildMember(
    client,
    {
      user: { id: '123456789012345683', username: 'other', discriminator: '0', avatar: null },
      nick: 'Thunderstorm',
      roles: [],
      joined_at: new Date(0).toISOString()
    },
    target.guild
  );
  target.guild.members.cache.set(other.id, other);
  const command = new UserInfoCommand(context('userinfo'));
  const resolve = vi.spyOn(memberResolver, 'resolve');
  const args = await command.messagePreParse(message, 'Thunder Wolf', {
    commandName: 'userinfo',
    prefix: '!',
    commandPrefix: '!'
  });
  await command.messageRun(message, args);
  expect(resolve.mock.calls.map((call) => call[1])).toEqual([['Thunder'], ['Thunder', 'Wolf']]);
  expect(JSON.stringify(vi.mocked(channel.send).mock.calls)).toContain('target');
});

test('failed role conversion preserves a multi-word role search', async () => {
  const { message, role, channel } = setup();
  role.name = 'Trusted Members';
  const command = new RoleInfoCommand(context('roleinfo'));
  const args = await command.messagePreParse(message, 'Trusted Members', {
    commandName: 'roleinfo',
    prefix: '!',
    commandPrefix: '!'
  });
  await command.messageRun(message, args);
  expect(JSON.stringify(vi.mocked(channel.send).mock.calls)).toContain('Trusted Members');
});
