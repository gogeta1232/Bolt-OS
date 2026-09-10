import mongoose from 'mongoose';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

class DatabaseService {
  public async connect(): Promise<void> {
    if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) return;

    if (mongoose.connection.listenerCount('connected') === 0) {
      mongoose.connection.on('connected', () => logger.info('Mongo connection established'));
      mongoose.connection.on('error', (error) => logger.error({ err: error }, 'Mongo connection error'));
      mongoose.connection.on('disconnected', () => logger.warn('Mongo connection lost'));
    }

    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS: 45_000,
      autoIndex: env.NODE_ENV !== 'production'
    });
  }

  public get isReady(): boolean {
    return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  }

  public async disconnect(): Promise<void> {
    if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;
    await mongoose.disconnect();
  }
}

export const database = new DatabaseService();
