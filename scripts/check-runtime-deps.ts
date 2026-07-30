#!/usr/bin/env node
/**
 * check-runtime-deps.ts — TASK-30: fail fast if a runtime-imported package is only
 * declared as a devDependency (or not declared at all). `dist/utils/tsconfig-finder.js`
 * importing `typescript` while it lived only in devDependencies is exactly the class of
 * bug this guards against: `npm link` masks it locally (the linked checkout's own
 * node_modules has every devDependency present), but a real `npm install -g` from a
 * packed tarball fails with ERR_MODULE_NOT_FOUND.
 *
 * Scans dist/**\/*.js for bare-specifier `import ... from '<pkg>'` / `require('<pkg>')` /
 * `import('<pkg>')` and asserts every resolved package name is listed in package.json's
 * `dependencies` (Node builtins and relative/absolute specifiers are skipped).
 *
 * Usage: node --experimental-strip-types scripts/check-runtime-deps.ts
 *   or:  npm run check:runtime-deps
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

export interface Violation {
  file: string;
  line: number;
  specifier: string;
  packageName: string;
}

function collectJsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && full.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

/** Package name a bare specifier resolves to: scoped `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`. */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null; // relative/absolute, not a package
  if (BUILTINS.has(specifier)) return null;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  return parts[0];
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function findBareSpecifiers(source: string): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      const line = source.slice(0, match.index).split('\n').length;
      found.push({ specifier, line });
    }
  }
  return found;
}

export function checkRuntimeDeps(distDir: string, packageJsonPath: string): Violation[] {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const declaredDeps = new Set(Object.keys(pkg.dependencies ?? {}));

  const violations: Violation[] = [];
  for (const file of collectJsFiles(distDir)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const { specifier, line } of findBareSpecifiers(source)) {
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName === null) continue;
      if (!declaredDeps.has(packageName)) {
        violations.push({ file, line, specifier, packageName });
      }
    }
  }
  return violations;
}

function main(): number {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const distDir = path.join(repoRoot, 'dist');
  const packageJsonPath = path.join(repoRoot, 'package.json');

  if (!fs.existsSync(distDir)) {
    process.stderr.write(`ERROR: ${distDir} not found — run "npm run build" first.\n`);
    return 2;
  }

  const violations = checkRuntimeDeps(distDir, packageJsonPath);
  if (violations.length === 0) {
    process.stdout.write('check-runtime-deps: OK — every runtime-imported package is a declared dependency.\n');
    return 0;
  }

  process.stderr.write(`check-runtime-deps: FAIL — ${violations.length} runtime import(s) missing from "dependencies":\n`);
  for (const v of violations) {
    process.stderr.write(
      `  ${path.relative(repoRoot, v.file)}:${v.line} — imports "${v.specifier}" (package "${v.packageName}" not in dependencies)\n`,
    );
  }
  return 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) process.exit(main());
