import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ":matches(ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration)[source.value=/^\\.{1,2}\\//][source.value=/\\.(js|ts|tsx)$/]",
          message: 'Use extensionless relative imports in apps/customer-portal.',
        },
      ],
    },
  },
])
