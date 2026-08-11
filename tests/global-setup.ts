/**
 * TASK-82: ensure native tree-sitter grammars are materialized before any
 * test run, so bare `npx vitest run` is green on a machine that only did
 * `npm ci` (where the optional native peers are never installed).
 *
 * The native grammars are OPTIONAL peers (TASK-41 "deterministic WASM
 * baseline"); bare `npm ci` never installs them, which makes ~397
 * native-parser tests fail with MODULE_NOT_FOUND. This globalSetup runs the
 * documented, idempotent installer (the same scratch-prefix recipe the CI
 * workflow uses) when the packages are missing. When they are present it is a
 * fast no-op, so CI (which installs them in its own step) and machines that
 * already ran `npm run test:native-setup` pay no cost.
 *
 * This is deliberately NOT a package.json lifecycle hook: the install-policy
 * tests forbid preinstall/install/postinstall/prepack scripts, and a vitest
 * globalSetup runs only when the test suite is invoked, never on install.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NATIVE_PKGS = [
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-cpp',
  '@tree-sitter-grammars/tree-sitter-kotlin',
];

export default function setup(): void {
  const missing = NATIVE_PKGS.filter(
    (pkg) => !existsSync(path.join(REPO_ROOT, 'node_modules', pkg))
  );
  if (missing.length === 0) {
    return; // already materialized — fast no-op
  }

  console.warn(
    `[global-setup] native tree-sitter grammars missing (${missing.join(', ')}) — ` +
      'running scripts/install-native-grammars.sh so the native-parser tests can run.'
  );
  execFileSync('bash', ['scripts/install-native-grammars.sh'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
