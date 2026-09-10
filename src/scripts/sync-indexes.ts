import 'dotenv/config';

import mongoose from 'mongoose';

import '../database/models/features/AfkProfile.js';
import '../database/models/features/AutoResponder.js';
import '../database/models/guild/ChannelSnapshot.js';
import '../database/models/guild/GuildConfig.js';
import '../database/models/moderation/Case.js';
import '../database/models/moderation/CaseCounter.js';
import '../database/models/moderation/MuteSchedule.js';
import '../database/models/moderation/Warning.js';
import { logger } from '../lib/logger.js';
import { database } from '../services/core/database.js';

const syncIndexes = async (): Promise<void> => {
  try {
    await database.connect();
    const results = await mongoose.syncIndexes();
    logger.info({ collections: Object.keys(results) }, 'Database indexes synchronized');
  } finally {
    await database.disconnect();
  }
};

void syncIndexes().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to synchronize database indexes');
  process.exitCode = 1;
});
