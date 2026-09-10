import 'dotenv/config';

import { ApplicationCommandRegistries, RegisterBehavior, container } from '@sapphire/framework';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { botConfig } from './config/bot.js';
import { env } from './config/env.js';
import { BotClient } from './lib/bot-client.js';
import { CommandRegistrationHelper } from './lib/command-registration.js';
import { logger } from './lib/logger.js';
import { startHeartbeatServer, stopHeartbeatServer } from './server/express.js';
import { configureContainer } from './setup/container.js';
import { initializeServices } from './setup/plugins.js';

const LOGIN_TIMEOUT_MS = 30_000;

ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.VerboseOverwrite);
ApplicationCommandRegistries.setBulkOverwriteRetries(10);

const baseUserDirectory = dirname(fileURLToPath(import.meta.url));
const client = new BotClient({
  ...botConfig.clientOptions,
  logger: { instance: logger },
  shards: env.SHARDS,
  baseUserDirectory
});

configureContainer(container);

let isShuttingDown = false;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const handleShutdown = async (exitCode = 0): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  container.logger.info('Shutting down...');

  container.reactionHandlerService.cleanup();
  container.snipe.shutdown();
  container.muteScheduler.shutdown();
  container.cases.shutdown();
  const results = await Promise.allSettled([client.destroy(), stopHeartbeatServer(), container.database.disconnect()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      container.logger.error({ err: result.reason }, 'Service shutdown failed');
    }
  }

  process.exitCode = exitCode;
};

const main = async (): Promise<void> => {
  try {
    await initializeServices();
    await startHeartbeatServer();
    await withTimeout(client.login(env.DISCORD_TOKEN), LOGIN_TIMEOUT_MS, 'Discord login timed out');
    container.logger.info('Client login successful');

    const healthTimer = setTimeout(() => {
      void CommandRegistrationHelper.checkRegistrationHealth().then((issues) => {
        issues.forEach((issue) => container.logger.info(`Command Health: ${issue}`));
      });
    }, 5_000);
    healthTimer.unref();
  } catch (error) {
    container.logger.fatal({ err: error }, 'Bot startup failed');
    await handleShutdown(1);
  }
};

process.on('unhandledRejection', (reason) => container.logger.error({ reason }, 'Unhandled rejection'));
process.on('uncaughtException', (error) => {
  container.logger.fatal({ err: error }, 'Uncaught exception');
  void handleShutdown(1);
});
process.on('SIGINT', () => void handleShutdown());
process.on('SIGTERM', () => void handleShutdown());

await main();
