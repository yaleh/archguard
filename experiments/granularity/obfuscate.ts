/**
 * obfuscate.ts — CLI entry (Stages 59.2 + 59.3).
 *
 * Obfuscates the scoped modules (src/mermaid + src/parser) plus their
 * repo-internal import closure into `obf/`, and writes the bidirectional
 * mapping to `artifacts/gt/mapping.json` (scoring/reconciliation only —
 * never enters any prompt, proposal §5 step 6).
 *
 * Usage: npx tsx obfuscate.ts
 */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GRANULARITY_ROOT, GT_DIR, OBF_DIR, ensureDirs } from './lib/paths.js';
import { DEFAULT_SEED, obfuscate, serializeMapping } from './lib/obfuscate/index.js';

const LEAK_PATTERN = /mermaid|archguard|diagram|parser|extractor|render|validator/i;

function listFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(suffix)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function main(): void {
  const repoRoot = path.resolve(GRANULARITY_ROOT, '..', '..');
  const started = Date.now();

  rmSync(OBF_DIR, { recursive: true, force: true });
  ensureDirs();

  const result = obfuscate({
    tsConfigFilePath: path.join(repoRoot, 'tsconfig.json'),
    repoRoot,
    entryGlobs: [
      path.join(repoRoot, 'src/mermaid/**/*.ts'),
      path.join(repoRoot, 'src/parser/**/*.ts'),
    ],
    closureDir: path.join(repoRoot, 'src'),
    outDir: OBF_DIR,
    seed: DEFAULT_SEED,
  });

  const mappingPath = path.join(GT_DIR, 'mapping.json');
  writeFileSync(mappingPath, serializeMapping(result.mapping), 'utf8');

  const m = result.mapping;
  console.log(`obfuscated tree: ${OBF_DIR}`);
  console.log(`  files:   ${result.fileCount} (${(result.totalBytes / 1024).toFixed(1)} KB)`);
  console.log(`  elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`mapping: ${mappingPath}`);
  console.log(`  entities: ${Object.keys(m.entities.forward).length}`);
  console.log(`  members:  ${Object.keys(m.members.forward).length}`);
  console.log(`  files:    ${Object.keys(m.files.forward).length}`);
  console.log(`  strings:  ${Object.keys(m.strings.forward).length}`);
  console.log(`  packages: ${Object.keys(m.packages.forward).length}`);
  console.log(`  locals:   ${Object.keys(m.locals.reverse).length}`);
  for (const w of result.warnings) console.warn(`warning: ${w}`);

  // Self-checks (pre-checks for the Phase 64 leak probe).
  let leaks = 0;
  let comments = 0;
  for (const fp of listFiles(OBF_DIR, '.ts')) {
    const text = readFileSync(fp, 'utf8');
    if (LEAK_PATTERN.test(text)) {
      leaks += 1;
      const hit = text.match(LEAK_PATTERN);
      console.error(`LEAK in ${path.relative(OBF_DIR, fp)}: '${hit?.[0] ?? '?'}'`);
    }
    if (/\/\/|\/\*/.test(text)) {
      comments += 1;
      console.error(`COMMENT residue in ${path.relative(OBF_DIR, fp)}`);
    }
  }
  console.log(`self-check: leaks=${leaks}, comment-files=${comments}`);
  if (leaks > 0 || comments > 0) process.exitCode = 1;
}

main();
