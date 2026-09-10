import { describe, expect, test } from 'vitest';

import { parseDuration } from '../../src/lib/utils/duration-parser.js';

describe('parseDuration', () => {
  test('parses combined human durations', () => {
    expect(parseDuration('1 day and 2h 30m')?.milliseconds).toBe(95_400_000);
  });

  test('rejects unknown or trailing content', () => {
    expect(parseDuration('forever')).toBeNull();
    expect(parseDuration('2h later')).toBeNull();
  });

  test('rejects empty and zero durations', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
  });
});
