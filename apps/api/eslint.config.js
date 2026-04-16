import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['coverage', 'dist']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ":matches(ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration)[source.value=/^\\.{1,2}\\//]:not([source.value=/\\.js$/])",
          message: 'Use .js on relative imports in apps/api.',
        },
      ],
    },
  },
])
