import { LogLevel, type ILogger } from '@sapphire/framework';
import pinoLogger, { type Level } from 'pino';

import { env } from '../config/env.js';

const pinoInstance = pinoLogger({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: true
          }
        }
      : undefined,
  base: {
    service: 'sapphire-hybrid-bot'
  }
});

type PinoLevel = Level | 'silent';

const levelMap: Record<LogLevel, PinoLevel> = {
  [LogLevel.Trace]: 'trace',
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Fatal]: 'fatal',
  [LogLevel.None]: 'silent'
};

const call = (level: Exclude<PinoLevel, 'silent'>) => (values: readonly unknown[]) => {
  Reflect.apply(pinoInstance[level], pinoInstance, Array.from(values));
};

const methodMap: Record<PinoLevel, (values: readonly unknown[]) => void> = {
  trace: call('trace'),
  debug: call('debug'),
  info: call('info'),
  warn: call('warn'),
  error: call('error'),
  fatal: call('fatal'),
  silent: () => {
    /* noop */
  }
};

export const logger: ILogger = {
  has(level) {
    const pinoLevel = levelMap[level];
    return pinoLevel === 'silent' ? false : pinoInstance.isLevelEnabled(pinoLevel);
  },
  trace(...values) {
    methodMap.trace(values);
  },
  debug(...values) {
    methodMap.debug(values);
  },
  info(...values) {
    methodMap.info(values);
  },
  warn(...values) {
    methodMap.warn(values);
  },
  error(...values) {
    methodMap.error(values);
  },
  fatal(...values) {
    methodMap.fatal(values);
  },
  write(level, ...values) {
    const method = methodMap[levelMap[level]] ?? methodMap.info;
    method(values);
  }
};
