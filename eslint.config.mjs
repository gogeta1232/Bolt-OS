import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const importRecommended = importPlugin.configs.recommended;
const importTypescript = importPlugin.configs.typescript;
const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    }
  },
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin
    },
    settings: {
      ...(importRecommended.settings ?? {}),
      ...(importTypescript?.settings ?? {}),
      'import/resolver': {
        typescript: {
          project: path.join(tsconfigRootDir, 'tsconfig.eslint.json')
        }
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...importRecommended.rules,
      ...(importTypescript?.rules ?? {}),
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreIIFE: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'import/order': [
        'error',
        { groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']], 'newlines-between': 'always' }
      ],
      'no-console': 'off'
    }
  },
  prettier
];
