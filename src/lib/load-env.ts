import { loadEnvFile } from 'node:process';

/** Load optional local configuration without overriding the host environment. */
export function loadEnvironmentFile(filePath: string): void {
  try {
    loadEnvFile(filePath);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw new Error('Unable to load environment configuration');
  }
}
