import { container } from '@sapphire/pieces';

import { database } from '../services/core/database.js';

export const initializeServices = async (): Promise<void> => {
  container.logger.info('Initializing data services');

  await database.connect();
  await container.muteScheduler.initialize();
};
