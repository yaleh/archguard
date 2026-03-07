#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const treeSitterDir = path.join(packageRoot, 'node_modules', 'tree-sitter');

if (!existsSync(treeSitterDir)) {
  process.exit(0);
}

try {
  require('tree-sitter');
  process.exit(0);
} catch (error) {
  if (error instanceof Error && error.message) {
    console.error(`[archguard] ${error.message}`);
  }
  console.error('[archguard] tree-sitter prebuilt binding is required.');
  console.error('[archguard] Source rebuilds are intentionally disabled for production installs.');
  console.error('[archguard] Install a release package that bundles the correct tree-sitter binary for this platform/runtime.');
  process.exit(1);
}
