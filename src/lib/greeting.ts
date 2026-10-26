import { parseDuration, type ParsedDuration } from './utils/duration-parser.js';

export const DEFAULT_GREET_DURATION_MS = 2_000;
export const MIN_GREET_DURATION_MS = 1_000;
export const MAX_GREET_DURATION_MS = 365 * 86_400_000;

export const resolveGreetDuration = (duration: unknown): number =>
  typeof duration === 'number' &&
  Number.isSafeInteger(duration) &&
  duration >= MIN_GREET_DURATION_MS &&
  duration <= MAX_GREET_DURATION_MS
    ? duration
    : DEFAULT_GREET_DURATION_MS;

export const parseGreetDuration = (input: string): ParsedDuration | null => {
  const duration = parseDuration(input);
  if (!duration || resolveGreetDuration(duration.milliseconds) !== duration.milliseconds) return null;
  return duration;
};
