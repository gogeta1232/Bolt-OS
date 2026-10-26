import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  // Exercise decorated Sapphire commands using the same standard decorator
  // transform as the production TypeScript build. Native Node cannot run them.
  plugins: [
    {
      name: 'bolt-command-decorators',
      enforce: 'pre',
      transform(code, id) {
        if (!/[/\\]src[/\\]commands[/\\].*\.ts$/.test(id)) return null;
        const result = transpileModule(code, {
          fileName: id,
          compilerOptions: { target: ScriptTarget.ES2023, module: ModuleKind.ESNext, sourceMap: true }
        });
        return { code: result.outputText, map: result.sourceMapText };
      }
    }
  ],
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/database/models/**', 'src/**/*.test.ts']
    }
  }
});
