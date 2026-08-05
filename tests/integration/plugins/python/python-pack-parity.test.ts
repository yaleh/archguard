/**
 * TASK-63 Phase D — Python pack parity integration test.
 *
 * Asserts that RuleBasedLanguagePlugin (driven by the declarative Python pack)
 * produces output within ±10% of the current imperative PythonPlugin on the
 * `tests/fixtures/python-simple/` fixture project, measured by entity count and
 * relation count.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PackRegistry, RuleBasedLanguagePlugin } from '@/core/index.js';
import { PythonPlugin } from '@/plugins/python/index.js';
import { wasmParserBackend } from '@/plugins/shared/wasm-parser-backend.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/python-simple', import.meta.url));

function deviationPct(actual: number, baseline: number): number {
  if (baseline === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (Math.abs(actual - baseline) / baseline) * 100;
}

describe('python pack parity vs imperative PythonPlugin', () => {
  const disposables: Array<{ dispose(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(disposables.splice(0).map((d) => d.dispose()));
  });

  it('produces entity/relation counts within ±10% of the imperative plugin', async () => {
    const pack = await new PackRegistry().resolve('python');
    if (!pack) throw new Error('built-in python pack not found');

    const ruleBased = new RuleBasedLanguagePlugin(pack);
    disposables.push(ruleBased);
    await ruleBased.initialize({ workspaceRoot: FIXTURE });
    const ruleResult = await ruleBased.parseProject(FIXTURE, { excludePatterns: [] });

    const imperative = new PythonPlugin(wasmParserBackend);
    disposables.push(imperative);
    await imperative.initialize({});
    const imperativeResult = await imperative.parseProject(FIXTURE, { excludePatterns: [] });

    const entityDeviation = deviationPct(
      ruleResult.entities.length,
      imperativeResult.entities.length
    );
    const relationDeviation = deviationPct(
      ruleResult.relations.length,
      imperativeResult.relations.length
    );

    // Evidence for the DoD / Contract report.
    process.stdout.write(
      `[python-parity] entities rule=${ruleResult.entities.length} ` +
        `imperative=${imperativeResult.entities.length} dev=${entityDeviation.toFixed(2)}%; ` +
        `relations rule=${ruleResult.relations.length} imperative=${imperativeResult.relations.length} ` +
        `dev=${relationDeviation.toFixed(2)}%\n`
    );

    expect(entityDeviation).toBeLessThanOrEqual(10);
    expect(relationDeviation).toBeLessThanOrEqual(10);
  });
});
