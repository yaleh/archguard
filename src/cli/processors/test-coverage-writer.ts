/**
 * TestCoverageWriter — renders the test coverage heatmap and writes it to disk.
 *
 * Extracted from DiagramProcessor.generateTestCoverageHeatmap (Plan 34 – Phase A1).
 *
 * @module cli/processors/test-coverage-writer
 */

import { TestCoverageRenderer } from '@/mermaid/test-coverage-renderer.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';
import type { ArchJSON } from '@/types/index.js';
import fs from 'fs-extra';
import path from 'path';

/**
 * Generate a test coverage heatmap Markdown file with a four-bucket Mermaid diagram.
 *
 * Writes `test/coverage-heatmap.md` under the given outputDir. This function is
 * intentionally NOT called from DiagramProcessor.processAll() — it is called from
 * run-analysis.ts after TestAnalyzer.analyze() completes and testAnalysis is available.
 *
 * @param analysis   The freshly computed TestAnalysis result.
 * @param archJson   The ArchJSON from which entity coverage is read.
 * @param outputDir  The base output directory (e.g. `.archguard`).
 */
export async function generateTestCoverageHeatmap(
  analysis: TestAnalysis,
  archJson: ArchJSON,
  outputDir: string
): Promise<void> {
  const renderer = new TestCoverageRenderer();
  const mermaidCode = renderer.render(analysis, archJson);

  const heatmapDir = path.join(outputDir, 'test');
  await fs.ensureDir(heatmapDir);

  const heatmapPath = path.join(heatmapDir, 'coverage-heatmap.md');
  const content = [
    '# Test Coverage Heatmap',
    '',
    '> Generated from test analysis — four buckets by coverage score',
    '',
    '```mermaid',
    mermaidCode,
    '```',
    '',
  ].join('\n');

  await fs.writeFile(heatmapPath, content, 'utf-8');
}
