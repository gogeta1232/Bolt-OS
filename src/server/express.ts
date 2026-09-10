import express from 'express';
import helmet from 'helmet';
import type { Server } from 'http';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { database } from '../services/core/database.js';

const SERVER_TIMEOUT_MS = 10_000;

let server: Server | null = null;

export async function startHeartbeatServer(): Promise<Server> {
  if (server) {
    return server;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (_request, response) => response.json({ service: 'bolt', status: 'ok' }));
  app.get('/health', (_request, response) => {
    const dependencies = { mongo: database.isReady };
    const isReady = dependencies.mongo;
    response.status(isReady ? 200 : 503).json({
      status: isReady ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies
    });
  });

  server = await new Promise<Server>((resolve, reject) => {
    const listener = app
      .listen(env.EXPRESS_PORT, env.EXPRESS_HOST, () => {
        logger.info({ host: env.EXPRESS_HOST, port: env.EXPRESS_PORT }, 'Heartbeat server listening');
        resolve(listener);
      })
      .on('error', (error) => {
        logger.error({ err: error }, 'Failed to start heartbeat server');
        reject(error);
      });
  });

  server.headersTimeout = SERVER_TIMEOUT_MS;
  server.requestTimeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = 5_000;

  return server;
}

export async function stopHeartbeatServer(): Promise<void> {
  if (!server) return;
  const activeServer = server;
  server = null;
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error closing heartbeat server');
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
