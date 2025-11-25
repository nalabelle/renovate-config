import tseslint from 'typescript-eslint';

/**
 * ESLint flat config for a strict, TypeScript-only Node project.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', '*.config.*', 'eslint.config.mjs']
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Project-specific tweaks on top of the recommended strict configs.
      'no-console': 'error'
    }
  }
);
