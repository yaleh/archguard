/**
 * TestCoverageRenderer — generates a four-bucket Mermaid `graph TD` heatmap
 * showing entity coverage from TestAnalysis data.
 *
 * Buckets:
 *   - Well Tested      : coverageScore >= 0.7
 *   - Partially Tested : 0.3 <= coverageScore < 0.7
 *   - Not Tested       : score < 0.3 (or entity not present in coverageMap)
 *   - Debug Only       : test files with testType === 'debug' (separate bucket)
 *
 * @module mermaid/test-coverage-renderer
 */

import type { TestAnalysis } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

const MAX_NODES_PER_BUCKET = 20;

export class TestCoverageRenderer {
  render(analysis: TestAnalysis, archJson: ArchJSON): string {
    const coveredMap = new Map<string, number>(); // entityId → score
    for (const link of analysis.coverageMap) {
      coveredMap.set(link.sourceEntityId, link.coverageScore);
    }

    const wellTested: string[] = [];
    const partiallyTested: string[] = [];
    const notTested: string[] = [];

    for (const entity of archJson.entities) {
      if (entity.type === 'class' || entity.type === 'interface') {
        const score = coveredMap.get(entity.id) ?? 0;
        const label = this.truncate(entity.name ?? entity.id, 30);
        if (score >= 0.7) wellTested.push(label);
        else if (score >= 0.3) partiallyTested.push(label);
        else notTested.push(label);
      }
    }

    const debugFiles = analysis.testFiles
      .filter((f) => f.testType === 'debug')
      .map((f) => this.truncate(f.id, 30));

    const lines: string[] = ['graph TD'];

    lines.push('  subgraph WT["✓ Well Tested (score ≥ 0.7)"]');
    const wtSlice = wellTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of wtSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (wellTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    wt_more["... +${wellTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    lines.push('  subgraph PT["~ Partially Tested (0.3 ≤ score < 0.7)"]');
    const ptSlice = partiallyTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of ptSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (partiallyTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    pt_more["... +${partiallyTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    lines.push('  subgraph NT["✗ Not Tested (score < 0.3)"]');
    const ntSlice = notTested.slice(0, MAX_NODES_PER_BUCKET);
    for (const label of ntSlice) {
      lines.push(`    ${this.nodeId(label)}["${label}"]`);
    }
    if (notTested.length > MAX_NODES_PER_BUCKET) {
      lines.push(`    nt_more["... +${notTested.length - MAX_NODES_PER_BUCKET} more"]`);
    }
    lines.push('  end');

    if (debugFiles.length > 0) {
      lines.push('  subgraph DO["⚠ Debug Only (zero assertions)"]');
      const doSlice = debugFiles.slice(0, MAX_NODES_PER_BUCKET);
      for (const label of doSlice) {
        lines.push(`    ${this.nodeId('do_' + label)}["${label}"]`);
      }
      if (debugFiles.length > MAX_NODES_PER_BUCKET) {
        lines.push(`    do_more["... +${debugFiles.length - MAX_NODES_PER_BUCKET} more"]`);
      }
      lines.push('  end');
    }

    return lines.join('\n');
  }

  private nodeId(label: string): string {
    return label.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  }

  private truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
  }
}
