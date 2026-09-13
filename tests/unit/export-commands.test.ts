import { describe, expect, it } from 'vitest';

import { buildExportPayload, parseCommandFile, readDefaultPrefix } from '../../src/scripts/export-commands.js';

const PING_SOURCE = `
@ApplyOptions<Command.Options>({
  name: 'ping',
  description: 'Check bot latency',
  requiredClientPermissions: ['SendMessages']
})
export class PingCommand extends Command {
  public override async chatInputRun() {}
  public override async messageRun() {}
}
`;

const BAN_SOURCE = `
import { AdminCommand } from '../../lib/structures/AdminCommand.js';
@ApplyOptions<Command.Options>({
  name: 'ban',
  description: 'Ban a member from the guild.',
  requiredClientPermissions: ['BanMembers', 'SendMessages']
})
export class BanCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder
      .addUserOption((option) => option.setName('target').setDescription('Member to ban').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for ban').setRequired(false)));
  }
  public override async chatInputRun() {}
  public override async messageRun() {}
}
`;

describe('parseCommandFile', () => {
  it('parses basic slash + prefix metadata', () => {
    const parsed = parseCommandFile(PING_SOURCE, 'src/commands/utility/ping.ts');

    expect(parsed).toMatchObject({
      name: 'ping',
      description: 'Check bot latency',
      module: 'utility',
      supportsSlash: true,
      supportsPrefix: true,
      adminOnly: false,
      prefixUsage: '!ping',
      requiredClientPermissions: ['SendMessages']
    });
  });

  it('parses slash options and admin marker', () => {
    const parsed = parseCommandFile(BAN_SOURCE, 'src/commands/moderation/ban.ts');

    expect(parsed?.adminOnly).toBe(true);
    expect(parsed?.prefixUsage).toBe('!ban <target> [reason]');
    expect(parsed?.slashOptions).toEqual([
      { name: 'target', description: 'Member to ban', type: 'User', required: true },
      { name: 'reason', description: 'Reason for ban', type: 'String', required: false }
    ]);
  });

  it('uses the configured default prefix for usage strings', () => {
    const parsed = parseCommandFile(PING_SOURCE, 'src/commands/utility/ping.ts', '?');
    expect(parsed?.prefixUsage).toBe('?ping');
  });

  it('returns null when name or description is missing', () => {
    expect(parseCommandFile('export const x = 1;', 'src/commands/utility/x.ts')).toBeNull();
  });
});

describe('readDefaultPrefix', () => {
  it('reads the Zod default from env config', () => {
    expect(readDefaultPrefix(`DEFAULT_PREFIX: z.string().trim().min(1).max(5).default('?'),`)).toBe('?');
  });

  it('falls back to ! when no default is declared', () => {
    expect(readDefaultPrefix('export const x = 1;')).toBe('!');
  });
});

describe('buildExportPayload', () => {
  it('counts commands and stamps source and prefix', () => {
    const parsed = parseCommandFile(PING_SOURCE, 'src/commands/utility/ping.ts');
    expect(parsed).not.toBeNull();
    if (parsed === null) return;

    const payload = buildExportPayload([parsed], '?');
    expect(payload.count).toBe(1);
    expect(payload.source).toBe('src/commands');
    expect(payload.defaultPrefix).toBe('?');
    expect(payload.commands).toHaveLength(1);
  });
});
