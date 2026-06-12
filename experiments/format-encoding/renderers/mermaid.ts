import type { C, CMethod, CParam, CRelation, RelationType } from '../lib/schema.js';

const REL_ARROW: Record<RelationType, string> = {
  inheritance: '--|>',
  implementation: '..|>',
  composition: '*--',
  aggregation: 'o--',
  call: '-->',
  dependency: '..>',
};

function renderMethodSignature(m: CMethod): string {
  const params = (m.params ?? []).map((p: CParam) => `${p.name} ${p.type}`).join(', ');
  const ret = m.returnType ?? 'void';
  return `${m.name}(${params}) ${ret}`;
}

// Replace all non-alphanumeric chars with _ to make a valid Mermaid identifier.
function sanitizeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

export function render(c: C): string {
  const lines: string[] = ['classDiagram'];

  const entityIdSet = new Set((c.entities ?? []).map(e => e.id));

  // Emit id-map for all entity IDs so the parser can recover originals.
  // Also emit id-map for orphaned relation from-IDs (not in entity list).
  // Format: %% id: <alias>=<original-id>
  for (const e of c.entities ?? []) {
    const alias = sanitizeName(e.id);
    lines.push(`%% id: ${alias}=${e.id}`);
  }
  // Emit id-map for all relation endpoint IDs that are not already covered by entities.
  // This ensures `to` IDs with special chars (e.g. "node:events") are recoverable by the parser.
  const relIdsSeen = new Set<string>();
  for (const r of c.relations ?? []) {
    for (const id of [r.from, r.to]) {
      if (!entityIdSet.has(id) && !relIdsSeen.has(id)) {
        relIdsSeen.add(id);
        lines.push(`%% id: ${sanitizeName(id)}=${id}`);
      }
    }
  }
  // Emit name-map for entity name (original case)
  for (const e of c.entities ?? []) {
    const alias = sanitizeName(e.id);
    lines.push(`%% name: ${alias}=${e.name}`);
  }
  // Emit source-map
  for (const e of c.entities ?? []) {
    const alias = sanitizeName(e.id);
    lines.push(`%% source: ${alias}=${e.sourceFile ?? 'unknown'}`);
  }

  for (const e of c.entities ?? []) {
    const className = sanitizeName(e.id);
    lines.push(`  class ${className} {`);
    lines.push(`    <<${e.type}>>`);
    for (const m of e.methods ?? []) {
      lines.push(`    +${renderMethodSignature(m)}`);
    }
    lines.push('  }');
  }

  for (const r of c.relations ?? []) {
    const arrow = REL_ARROW[r.type] ?? '-->';
    const from = sanitizeName(r.from);
    const to = sanitizeName(r.to);
    // Always emit a label so the parser can recover the exact relation type
    lines.push(`  ${from} ${arrow} ${to} : ${r.type}`);
  }

  return lines.join('\n');
}
