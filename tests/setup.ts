import { beforeEach, vi } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['DISCORD_TOKEN'] = 'test-token-that-is-never-used';
process.env['DISCORD_CLIENT_ID'] = '123456789012345678';
process.env['MONGO_URI'] = 'mongodb://127.0.0.1:27017/bolt-test';

// Mock minimal container for unit tests
vi.mock('@sapphire/framework', async () => {
  const actual = await vi.importActual<typeof import('@sapphire/framework')>('@sapphire/framework');
  return {
    ...actual,
    container: {
      logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
      client: { user: { id: 'test-bot-id' }, ws: { ping: 42 } },
      config: { fetch: vi.fn().mockResolvedValue({ prefix: '!', logChannels: {}, adminRoleIds: [] }) }
    }
  };
});

beforeEach(() => vi.clearAllMocks());
