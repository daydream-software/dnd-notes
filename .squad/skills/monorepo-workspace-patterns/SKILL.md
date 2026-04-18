# Skill: Monorepo Workspace Patterns

**Category:** Project Structure  
**Applies to:** Node.js monorepos with npm workspaces  
**Created:** 2026-04-18  
**Source:** Issue #53 (control-plane service addition)

## Pattern

When adding a new service workspace to the monorepo:

### 1. Directory Structure

```
apps/{service-name}/
 src/
   ├── index.ts        # Entry point with startup/shutdown
   ├── app.ts          # Express app factory
   ├── {domain}.ts     # Domain logic modules
   └── types.ts        # Shared types
 test/
   └── app.test.ts     # Integration tests
 package.json        # Workspace package
 tsconfig.json       # TypeScript config
 eslint.config.js    # ESLint config
 .env.example        # Environment template
 README.md           # Service documentation
```

### 2. Package.json Pattern

```json
{
  "name": "@{project}/{service}",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch --clear-screen=false src/index.ts",
    "build": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "start": "node dist/index.js",
    "test": "node --import tsx --test test/*.test.ts"
  }
}
```

**Key points:**
- Use scoped package names (`@project/service`)
- Include `dev`, `build`, `lint`, `start`, `test` scripts
- Use `tsx watch` for dev mode with `--clear-screen=false`
- Use Node.js built-in test runner (`--test`)

### 3. TypeScript Config Pattern

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noEmitOnError": true,
    "skipLibCheck": true,
    "types": ["node"],
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**Critical:** Use `NodeNext` module resolution for ESM.

### 4. ESLint Config Pattern

```javascript
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
          message: 'Use .js on relative imports in apps/{service}.',
        },
      ],
    },
  },
])
```

**Critical:** Enforce `.js` extension on relative imports (ESM requirement).

### 5. Root Package.json Updates

Add to `workspaces` array:
```json
{
  "workspaces": [
    "apps/web",
    "apps/api",
    "apps/{new-service}"
  ]
}
```

Add convenience script:
```json
{
  "scripts": {
    "dev:{service}": "npm run dev --workspace apps/{service}"
  }
}
```

### 6. Validation Checklist

After adding a workspace:

```bash
# Install dependencies
npm install

# Validate lint
npm run lint --workspace apps/{service}

# Validate build
npm run build --workspace apps/{service}

# Validate tests
npm test --workspace apps/{service}

# Validate from root
npm run lint
npm run build
npm test
```

## Anti-Patterns

 **Don't:**
- Omit `.js` extensions on relative imports (ESM will fail)
- Use different TypeScript configs across services (breaks consistency)
- Skip the `.env.example` file (forces guessing at runtime config)
- Forget to update root `package.json` workspaces array
- Use different test runners across services

## Example

See `apps/control-plane/` for reference implementation following this pattern.

## Related Skills

- `express-route-guardrails` — API endpoint patterns
- `create-update-validation-split` — Zod validation patterns
