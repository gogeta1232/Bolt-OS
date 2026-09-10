import type { Container } from '@sapphire/framework';

import { env } from '../config/env.js';
import { database } from '../services/core/database.js';
import { configService } from '../services/core/config-service.js';
import { loggingService } from '../services/core/logging-service.js';
import { memberResolver } from '../services/core/member-resolver.js';
// Moderation services
import { caseService } from '../services/moderation/case-service.js';
import { warningService } from '../services/moderation/warning-service.js';
import { muteSchedulerService } from '../services/moderation/mute-scheduler-service.js';
// Features services
import { afkService } from '../services/features/afk-service.js';
import { autoResponderService } from '../services/features/autoresponder-service.js';
import { SnipeService } from '../services/features/snipe-service.js';
// Lib services
import { reactionHandlerService } from '../lib/reaction-handler/service.js';

export const configureContainer = (container: Container) => {
  container.database = database;
  container.config = configService;
  container.env = env;
  container.logging = loggingService;
  container.autoResponders = autoResponderService;
  container.cases = caseService;
  container.afk = afkService;
  container.warnings = warningService;
  container.memberResolver = memberResolver;
  container.muteScheduler = muteSchedulerService;
  container.reactionHandlerService = reactionHandlerService;
  container.snipe = new SnipeService();
};

declare module '@sapphire/pieces' {
  interface Container {
    database: typeof database;
    config: typeof configService;
    env: typeof env;
    logging: typeof loggingService;
    autoResponders: typeof autoResponderService;
    cases: typeof caseService;
    afk: typeof afkService;
    warnings: typeof warningService;
    memberResolver: typeof memberResolver;
    muteScheduler: typeof muteSchedulerService;
    reactionHandlerService: typeof reactionHandlerService;
    snipe: SnipeService;
  }
}
