import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

test('importing command export helpers does not execute the CLI or regenerate tracked docs', async () => {
  const source = new URL('../../src/scripts/export-commands.ts', import.meta.url).href;
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `await import(${JSON.stringify(source)});`],
    { timeout: 10_000 }
  );
  expect(stdout).toBe('');
  expect(stderr).toBe('');
}, 15_000);
