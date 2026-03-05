import type { ArchJSON } from '@/types/index.js';

/**
 * Generates a simple flowchart for C++ package-level diagrams.
 * Each package is a node; relations are directed edges.
 */
export class CppPackageFlowchartGenerator {
  generate(archJSON: ArchJSON): string {
    const { entities, relations } = archJSON;

    if (!entities || entities.length === 0) {
      return 'flowchart LR\n  empty["(no packages found)"]';
    }

    const lines: string[] = [
      '%%{init: {\'flowchart\': {\'nodeSpacing\': 50, \'rankSpacing\': 80}}}%%',
      'flowchart LR',
    ];

    // Sanitize node IDs (replace . and / and - with _)
    const sanitize = (id: string) => id.replace(/[.\-\/]/g, '_');

    // Node declarations
    for (const entity of entities) {
      const nodeId = sanitize(entity.id || entity.name);
      const label = entity.name;
      lines.push(`  ${nodeId}["${label}"]`);
    }

    // Edge declarations
    const entityIds = new Set(entities.map(e => sanitize(e.id || e.name)));
    for (const rel of (relations ?? [])) {
      const srcId = sanitize(rel.source);
      const tgtId = sanitize(rel.target);
      // Only render edges where both ends are known nodes
      if (!entityIds.has(srcId) || !entityIds.has(tgtId)) continue;

      let arrow = '-->';
      if (rel.type === 'composition') arrow = '-->';
      else if (rel.type === 'aggregation') arrow = '--->';
      lines.push(`  ${srcId} ${arrow} ${tgtId}`);
    }

    return lines.join('\n');
  }
}
