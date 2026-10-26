import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironmentFile } from '../../src/lib/load-env.js';

describe('native environment loading', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bolt-env-test-'));
    filePath = join(directory, '.env');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(filePath, { force: true });
    rmdirSync(directory);
  });

  it('allows an absent local file', () => {
    expect(() => loadEnvironmentFile(filePath)).not.toThrow();
  });

  it('preserves host variables including empty values', () => {
    vi.stubEnv('BOLT_ENV_TEST_EXISTING', 'host-value');
    vi.stubEnv('BOLT_ENV_TEST_EMPTY', '');
    writeFileSync(filePath, 'BOLT_ENV_TEST_EXISTING=file-value\nBOLT_ENV_TEST_EMPTY=file-value\n');

    loadEnvironmentFile(filePath);

    expect(process.env['BOLT_ENV_TEST_EXISTING']).toBe('host-value');
    expect(process.env['BOLT_ENV_TEST_EMPTY']).toBe('');
  });

  it('parses quoted values, comments and multiline values', () => {
    vi.stubEnv('BOLT_ENV_TEST_QUOTED', undefined);
    vi.stubEnv('BOLT_ENV_TEST_MULTILINE', undefined);
    writeFileSync(
      filePath,
      'BOLT_ENV_TEST_QUOTED="value # inside" # comment\nBOLT_ENV_TEST_MULTILINE="first\nsecond"\n'
    );

    loadEnvironmentFile(filePath);

    expect(process.env['BOLT_ENV_TEST_QUOTED']).toBe('value # inside');
    expect(process.env['BOLT_ENV_TEST_MULTILINE']).toBe('first\nsecond');
  });

  it('reports unreadable files without exposing their contents', () => {
    expect(() => loadEnvironmentFile(directory)).toThrow('Unable to load environment configuration');
  });
});
