import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

import type { GreetDeletionDocument } from '../../src/database/models/features/GreetDeletion.js';
import { GreetingService } from '../../src/services/features/greeting-service.js';

interface GuildQuery {
  guildId: { $in: string[] };
}
interface DueQuery extends GuildQuery {
  nextAttemptAt: { $lte: Date };
  deleteAt: { $lte: Date };
}
interface Claim {
  messageId: string;
  nextAttemptAt: Date;
}

const boundary = vi.hoisted(() => {
  const jobs = new Map<string, GreetDeletionDocument>();
  const removeMessage = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const message = { id: 'message', createdTimestamp: 0, author: { id: 'bot' }, delete: removeMessage };
  const channel = {
    isTextBased: () => true,
    send: vi.fn(async () => message),
    messages: { fetch: vi.fn(async () => message) }
  };
  const guild = { id: 'guild', available: true, channels: { fetch: vi.fn(async () => channel) } };
  const config = { greetChannels: ['channel'], greetMessage: 'Hello {{user}}!', greetDurationMs: 2_000 };
  const client = { isReady: vi.fn(() => true), user: { id: 'bot' }, guilds: { cache: new Map([['guild', guild]]) } };
  const logger = { error: vi.fn(), warn: vi.fn() };
  const fetchConfig = vi.fn(async () => config);
  const matches = (entry: GreetDeletionDocument, claim: Claim): boolean =>
    entry.messageId === claim.messageId && entry.nextAttemptAt.getTime() === claim.nextAttemptAt.getTime();
  const model = {
    create: vi.fn(async (entry: GreetDeletionDocument) => {
      jobs.set(entry.messageId, { ...entry });
    }),
    findOneAndUpdate: vi.fn((query: DueQuery, update: { $set: { nextAttemptAt: Date } }) => ({
      lean: () => ({
        exec: async () => {
          const entry = [...jobs.values()]
            .filter(
              (job) =>
                query.guildId.$in.includes(job.guildId) &&
                job.nextAttemptAt <= query.nextAttemptAt.$lte &&
                job.deleteAt <= query.deleteAt.$lte
            )
            .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
          if (!entry) return null;
          entry.nextAttemptAt = update.$set.nextAttemptAt;
          return { ...entry };
        }
      })
    })),
    findOne: vi.fn((query: GuildQuery) => ({
      sort: () => ({
        lean: () => ({
          exec: async () =>
            [...jobs.values()]
              .filter((job) => query.guildId.$in.includes(job.guildId))
              .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0] ?? null
        })
      })
    })),
    deleteOne: vi.fn((claim: Claim) => ({
      exec: async () => {
        const entry = jobs.get(claim.messageId);
        if (entry && matches(entry, claim)) jobs.delete(entry.messageId);
      }
    })),
    updateOne: vi.fn((claim: Claim, update: { $set: { nextAttemptAt: Date } }) => ({
      exec: async () => {
        const entry = jobs.get(claim.messageId);
        if (entry && matches(entry, claim)) entry.nextAttemptAt = update.$set.nextAttemptAt;
      }
    })),
    deleteMany: vi.fn((query: { guildId: string }) => ({
      exec: async () => {
        for (const entry of jobs.values()) if (entry.guildId === query.guildId) jobs.delete(entry.messageId);
      }
    }))
  };
  return { jobs, removeMessage, message, channel, guild, config, client, logger, fetchConfig, model };
});

vi.mock('@sapphire/framework', () => ({
  container: {
    client: boundary.client,
    config: { fetch: boundary.fetchConfig },
    logger: boundary.logger
  }
}));
vi.mock('../../src/database/models/features/GreetDeletion.js', () => ({ GreetDeletionModel: boundary.model }));

let service: GreetingService;
const target = { guildId: 'guild', userId: 'user', mention: '<@user>' };

const seed = (delayMs: number, guildId = 'guild'): void => {
  const deleteAt = new Date(Date.now() + delayMs);
  boundary.jobs.set('message', {
    guildId,
    channelId: 'channel',
    messageId: 'message',
    deleteAt,
    nextAttemptAt: deleteAt
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.clearAllMocks();
  boundary.jobs.clear();
  boundary.message.createdTimestamp = Date.now();
  boundary.message.author.id = 'bot';
  boundary.config.greetChannels = ['channel'];
  boundary.config.greetDurationMs = 2_000;
  boundary.client.isReady.mockReturnValue(true);
  boundary.removeMessage.mockResolvedValue(undefined);
  boundary.channel.send.mockResolvedValue(boundary.message);
  boundary.channel.messages.fetch.mockResolvedValue(boundary.message);
  boundary.guild.channels.fetch.mockResolvedValue(boundary.channel);
  boundary.fetchConfig.mockResolvedValue(boundary.config);
  service = new GreetingService();
});

afterEach(async () => {
  await service.shutdown();
  vi.useRealTimers();
});

describe('automatic greeting expiry', () => {
  test('sends only on join, limits mentions and deletes at the configured deadline', async () => {
    boundary.config.greetDurationMs = 300_000;
    service.initialize();
    await service.greet(target);
    expect(boundary.channel.send).toHaveBeenCalledWith({
      content: 'Hello <@user>!',
      allowedMentions: { parse: [], users: ['user'] }
    });
    expect(boundary.jobs.get('message')?.deleteAt.getTime()).toBe(Date.now() + 300_000);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(boundary.removeMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
    expect(boundary.jobs.size).toBe(0);
  });

  test('does nothing when greet channels are disabled', async () => {
    boundary.config.greetChannels = [];
    await service.greet(target);
    expect(boundary.channel.send).not.toHaveBeenCalled();
  });

  test('restores a pending deletion after restart without resending the greeting', async () => {
    service.initialize();
    await service.greet(target);
    await service.shutdown();
    await vi.advanceTimersByTimeAsync(5_000);
    service = new GreetingService();
    service.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.channel.send).toHaveBeenCalledOnce();
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
    expect(boundary.jobs.size).toBe(0);
  });

  test('does not execute long durations early or overflow a timer', async () => {
    seed(30 * 86_400_000);
    service.initialize();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(boundary.removeMessage).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 30 * 86_400_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
  });

  test('retains failed deletions and retries them', async () => {
    seed(-1);
    boundary.removeMessage.mockRejectedValueOnce(new Error('Temporary Discord failure'));
    service.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.jobs.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(boundary.removeMessage).toHaveBeenCalledTimes(2);
    expect(boundary.jobs.size).toBe(0);
  });

  test("waits until the gateway is ready and only handles this process's guilds", async () => {
    seed(-1, 'other-guild');
    boundary.client.isReady.mockReturnValue(false);
    service.initialize();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(boundary.model.findOneAndUpdate).not.toHaveBeenCalled();
    boundary.client.isReady.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(boundary.removeMessage).not.toHaveBeenCalled();
    expect(boundary.jobs.size).toBe(1);
  });

  test("does not delete another author's message", async () => {
    seed(-1);
    boundary.message.author.id = 'someone-else';
    service.initialize();
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.removeMessage).not.toHaveBeenCalled();
    expect(boundary.jobs.size).toBe(0);
  });

  test('removes the greeting immediately if its deletion cannot be persisted', async () => {
    boundary.model.create.mockRejectedValueOnce(new Error('Database unavailable'));
    await service.greet(target);
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
    expect(boundary.jobs.size).toBe(0);
  });

  test('initialization is idempotent and shutdown disposes the timer', async () => {
    service.initialize();
    service.initialize();
    expect(vi.getTimerCount()).toBe(1);
    await service.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('removes pending jobs after the bot leaves a guild', async () => {
    seed(86_400_000);
    await service.clearGuild('guild');
    expect(boundary.jobs.size).toBe(0);
  });

  test.each([RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel])(
    'completes cleanup when Discord reports missing resource %s',
    async (code) => {
      seed(-1);
      boundary.channel.messages.fetch.mockRejectedValueOnce(
        new DiscordAPIError({ code, message: 'Missing resource' }, code, 404, 'GET', 'https://discord.com/api/test', {})
      );
      service.initialize();
      await vi.advanceTimersByTimeAsync(0);
      expect(boundary.removeMessage).not.toHaveBeenCalled();
      expect(boundary.jobs.size).toBe(0);
    }
  );

  test('does not change existing deadlines when the configured duration changes', async () => {
    service.initialize();
    await service.greet(target);
    boundary.config.greetDurationMs = 86_400_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
  });

  test('does not overlap a leased deletion and resumes it after a crashed worker', async () => {
    seed(-1);
    const job = boundary.jobs.get('message');
    if (!job) throw new Error('Missing seeded job');
    job.nextAttemptAt = new Date(Date.now() + 300_000);
    service.initialize();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(boundary.removeMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(boundary.removeMessage).toHaveBeenCalledOnce();
  });

  test('waits for an in-flight greeting to persist before shutdown completes', async () => {
    let persist: () => void = () => {
      throw new Error('Persistence not started');
    };
    boundary.model.create.mockImplementationOnce(
      (entry) =>
        new Promise<void>((resolve) => {
          persist = () => {
            boundary.jobs.set(entry.messageId, entry);
            resolve();
          };
        })
    );
    const greeting = service.greet(target);
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = service.shutdown().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    persist();
    await Promise.all([greeting, stopping]);
    expect(boundary.jobs.size).toBe(1);
    await service.greet(target);
    expect(boundary.channel.send).toHaveBeenCalledOnce();
  });

  test('continues greeting other channels if a send fails', async () => {
    boundary.config.greetChannels = ['first', 'second'];
    boundary.channel.send.mockRejectedValueOnce(new Error('Missing permissions'));
    await service.greet(target);
    expect(boundary.channel.send).toHaveBeenCalledTimes(2);
    expect(boundary.jobs.size).toBe(1);
  });
});
