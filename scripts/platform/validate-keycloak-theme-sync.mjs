#!/usr/bin/env node
/**
 * Validates that every text/font key in the platform-keycloak-themes-* ConfigMaps
 * inside platform/k3d/keycloak.yaml matches the corresponding source file under
 * platform/keycloak/base/themes/ (the canonical on-disk location, moved from
 * platform/k3d/keycloak-themes/ in issue #226).
 *
 * Exits 0 on clean sync, 1 on any drift.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

const manifestPath = join(root, 'platform/k3d/keycloak.yaml');
const manifest = readFileSync(manifestPath, 'utf8');

const drift = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the value of a literal block scalar (|) key from a YAML document
 * chunk.  Keys live at 2-space indent; content at 4-space indent.
 * The YAML '|' block scalar preserves exactly one trailing newline.
 *
 * Each content line is either 4-space-indented or completely empty (blank
 * lines inside template files are stored as bare newlines in the YAML).
 */
function extractTextBlock(text, key) {
  const pattern = new RegExp(
    `^  ${escapeRe(key)}: \\|\n((?:^(?:    .*|)\\n)*)`,
    'm',
  );
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].replace(/^ {4}/gm, '');
}

/**
 * Extract a plain-scalar binaryData value (key: <base64>) from a YAML chunk.
 */
function extractBinaryBase64(text, key) {
  const pattern = new RegExp(`^  ${escapeRe(key)}: (.+)$`, 'm');
  const match = text.match(pattern);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Slice out the raw YAML text of a named ConfigMap document.
 */
function extractConfigMapBlock(name) {
  const docs = manifest.split(/^---\s*$/m);
  for (const doc of docs) {
    if (doc.includes(`name: ${name}`) && doc.includes('kind: ConfigMap')) {
      return doc;
    }
  }
  return null;
}

/**
 * Scan a block of text for all op-* or cu-* literal-block-scalar keys and
 * return an array of key names found.
 */
function findPrefixedKeys(text) {
  const found = [];
  const pattern = /^  ((?:op|cu|ac)-[^\s:]+):\s+\|/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found.push(match[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Text-file mapping table
// ---------------------------------------------------------------------------

const TEXT_KEYS = [
  // [configmap-key, relative-path-under-operator-login/]
  ['op-theme.properties',         'theme.properties'],
  ['op-template.ftl',             'login/template.ftl'],
  ['op-login.ftl',                'login/login.ftl'],
  ['op-login-reset-password.ftl', 'login/login-reset-password.ftl'],
  ['op-login-otp.ftl',            'login/login-otp.ftl'],
  ['op-login.css',                'login/resources/css/login.css'],
  ['op-daydream-mark.svg',        'login/resources/img/daydream-mark.svg'],
  ['op-messages_en.properties',   'login/messages/messages_en.properties'],
  // [configmap-key, relative-path-under-customer-login/]
  ['cu-theme.properties',         'theme.properties'],
  ['cu-template.ftl',             'login/template.ftl'],
  ['cu-login.ftl',                'login/login.ftl'],
  ['cu-login-reset-password.ftl', 'login/login-reset-password.ftl'],
  ['cu-login-otp.ftl',            'login/login-otp.ftl'],
  ['cu-login.css',                'login/resources/css/login.css'],
  ['cu-dnd-notes-mark.svg',       'login/resources/img/dnd-notes-mark.svg'],
  ['cu-messages_en.properties',   'login/messages/messages_en.properties'],
  // [configmap-key, relative-path-under-account-console/]
  ['ac-theme.properties',         'theme.properties'],
  ['ac-account.css',              'account/resources/css/account.css'],
  ['ac-dnd-notes-mark.svg',       'account/resources/img/dnd-notes-mark.svg'],
];

function themeDir(key) {
  if (key.startsWith('op-')) return 'operator-login';
  if (key.startsWith('ac-')) return 'account-console';
  return 'customer-login';
}

// ---------------------------------------------------------------------------
// Font mapping table
// ---------------------------------------------------------------------------

const FONT_KEYS = ['Geist-Variable.woff2', 'GeistMono-Variable.woff2'];

// ---------------------------------------------------------------------------
// Check text ConfigMap
// ---------------------------------------------------------------------------

const textBlock = extractConfigMapBlock('platform-keycloak-themes-text');
if (!textBlock) {
  drift.push('Cannot locate ConfigMap platform-keycloak-themes-text in keycloak.yaml');
} else {
  const seenKeys = new Set();

  for (const [cmKey, relPath] of TEXT_KEYS) {
    seenKeys.add(cmKey);

    const cmContent = extractTextBlock(textBlock, cmKey);
    if (cmContent === null) {
      drift.push(`ConfigMap key ${cmKey} not found in platform-keycloak-themes-text`);
      continue;
    }

    const srcPath = join(root, 'platform/keycloak/base/themes', themeDir(cmKey), relPath);
    if (!existsSync(srcPath)) {
      drift.push(`Source file missing: ${relative(root, srcPath)} (referenced by ConfigMap key ${cmKey})`);
      continue;
    }

    const diskContent = readFileSync(srcPath, 'utf8');
    if (cmContent !== diskContent) {
      drift.push(
        `Content mismatch: ConfigMap key ${cmKey} vs ${relative(root, srcPath)}\n` +
        `    ConfigMap: ${cmContent.length} bytes  |  on-disk: ${diskContent.length} bytes`,
      );
    }
  }

  // Detect unexpected op-*/cu-* keys in the ConfigMap not covered by the table.
  for (const cmKey of findPrefixedKeys(textBlock)) {
    if (!seenKeys.has(cmKey)) {
      drift.push(`Unmapped ConfigMap key ${cmKey} in platform-keycloak-themes-text -- add it to the sync-check table`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check fonts ConfigMap
// ---------------------------------------------------------------------------

const fontsBlock = extractConfigMapBlock('platform-keycloak-themes-fonts');
if (!fontsBlock) {
  drift.push('Cannot locate ConfigMap platform-keycloak-themes-fonts in keycloak.yaml');
} else {
  for (const fontKey of FONT_KEYS) {
    const b64 = extractBinaryBase64(fontsBlock, fontKey);
    if (b64 === null) {
      drift.push(`Font key ${fontKey} not found in platform-keycloak-themes-fonts`);
      continue;
    }

    const cmBytes = Buffer.from(b64, 'base64');

    const fontPaths = [
      join(root, 'platform/keycloak/base/themes/operator-login/login/resources/fonts', fontKey),
      join(root, 'platform/keycloak/base/themes/customer-login/login/resources/fonts', fontKey),
    ];

    for (const fontPath of fontPaths) {
      if (!existsSync(fontPath)) {
        drift.push(`Font file missing: ${relative(root, fontPath)} (referenced by ConfigMap key ${fontKey})`);
        continue;
      }
      const diskBytes = readFileSync(fontPath);
      if (!cmBytes.equals(diskBytes)) {
        drift.push(
          `Font mismatch: ConfigMap key ${fontKey} differs from ${relative(root, fontPath)}\n` +
          `    ConfigMap decoded: ${cmBytes.length} bytes  |  on-disk: ${diskBytes.length} bytes`,
        );
      }
    }

    // Report if the two on-disk copies diverge from each other.
    const [opPath, cuPath] = fontPaths;
    if (existsSync(opPath) && existsSync(cuPath)) {
      const opBytes = readFileSync(opPath);
      const cuBytes = readFileSync(cuPath);
      if (!opBytes.equals(cuBytes)) {
        drift.push(
          `Font mismatch: operator-login and customer-login copies of ${fontKey} are not byte-identical`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (drift.length === 0) {
  console.log('keycloak-themes sync check passed -- k3d ConfigMap and on-disk source files are in sync');
  process.exit(0);
} else {
  process.stderr.write(
    `keycloak-themes sync check failed -- ${drift.length} drift(s) detected:\n`,
  );
  for (const msg of drift) {
    process.stderr.write(`  - ${msg}\n`);
  }
  process.stderr.write(
    '\nFix: update platform/k3d/keycloak.yaml ConfigMap data to match the source files\n' +
    'under platform/keycloak/base/themes/\n',
  );
  process.exit(1);
}
