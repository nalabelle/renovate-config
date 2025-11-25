import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/**
 * ESLint flat config for a strict, TypeScript-only Node project.
 *
 * This composes the upstream @typescript-eslint "strict-type-checked" and
 * "stylistic-type-checked" configs so we inherit their recommended rules,
 * then applies a couple of local tweaks.
 */
const strictTypeChecked = tseslint.configs['strict-type-checked'];
const stylisticTypeChecked = tseslint.configs['stylistic-type-checked'];

function withTsOverrides(baseConfig) {
  return {
    ...baseConfig,
    files: ['src/**/*.ts', 'vitest.config.ts'],
    languageOptions: {
      ...(baseConfig.languageOptions ?? {}),
      parser: tsParser,
      parserOptions: {
        ...(baseConfig.languageOptions?.parserOptions ?? {}),
        sourceType: 'module',
        ecmaVersion: 'latest',
        project: false
      }
    }
  };
}

export default [
  withTsOverrides(strictTypeChecked),
  withTsOverrides(stylisticTypeChecked),
  {
    rules: {
      // Project-specific tweaks on top of the recommended strict configs.
      'no-console': 'error'
    }
  }
];
