/**
 * Documented language-list consistency guard (P2-1).
 *
 * Adding a language should update every public surface: the --lang help text,
 * the user guide option table, and the config-loader schema comment. This test
 * fails if one surface forgets a language, so a new language can never be added
 * "in only one place" silently.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

/** The canonical set of analyzable languages. */
const EXPECTED = new Set(['typescript', 'go', 'java', 'python', 'cpp', 'kotlin', 'dart']);

/** Collect every language token mentioned in a text blob. */
function langsIn(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/typescript|go|java|python|cpp|kotlin|dart/g)) set.add(m[0]);
  return set;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('documented language lists stay in sync (P2-1)', () => {
  it('cli-usage.md, config-loader schema comment, and analyze --lang help all list the same languages', () => {
    const inCliUsage = langsIn(read('docs/user-guide/cli-usage.md'));
    const inConfigLoader = langsIn(read('src/cli/config-loader.ts'));
    const inAnalyze = langsIn(read('src/cli/commands/analyze.ts'));

    expect(inCliUsage).toEqual(EXPECTED);
    expect(inConfigLoader).toEqual(EXPECTED);
    expect(inAnalyze).toEqual(EXPECTED);
  });

  it('the user guide explicitly calls out the Dart WASM grammar', () => {
    const cliUsage = read('docs/user-guide/cli-usage.md');
    const langLine = cliUsage.split('\n').find((l) => l.includes('--lang <language>')) ?? '';
    expect(langLine).toContain('dart');
    expect(langLine).toBeTruthy();
  });
});
