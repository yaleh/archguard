import type { C, CEntity, CMethod, CParam, CRelation } from '../lib/schema.js';

function renderParamSig(params: CParam[]): string {
  if (!params || params.length === 0) return '()';
  return '(' + params.map((p) => `${p.name}:${p.type}`).join(', ') + ')';
}

function sanitizeHaskellId(s: string): string {
  // Haskell identifiers: start with letter/underscore, rest alnum/_
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([^a-zA-Z_])/, '_$1');
}

function capitalise(s: string): string {
  if (!s) return s;
  const safe = sanitizeHaskellId(s);
  return safe.charAt(0).toUpperCase() + safe.slice(1);
}

export function render(c: C): string {
  const entityIdSet = new Set((c.entities ?? []).map(e => e.id));

  // Separate orphaned relations (from-entity not in entity list).
  const orphanedRelations: CRelation[] = [];
  const relsByFrom = new Map<string, Map<string, string[]>>();
  for (const rel of c.relations ?? []) {
    if (!entityIdSet.has(rel.from)) {
      orphanedRelations.push(rel);
      continue;
    }
    if (!relsByFrom.has(rel.from)) relsByFrom.set(rel.from, new Map());
    const byType = relsByFrom.get(rel.from)!;
    if (!byType.has(rel.type)) byType.set(rel.type, []);
    byType.get(rel.type)!.push(rel.to);
  }

  const blocks: string[] = [];

  for (const e of c.entities ?? []) {
    const typeName = capitalise(e.name || e.id);
    const lines: string[] = [];

    lines.push(`-- | id: ${e.id}`);
    lines.push(`-- | name: ${e.name}`);
    lines.push(`-- | source: ${e.sourceFile ?? 'unknown'}`);
    lines.push(`data ${typeName} :: ${e.type} = ${typeName}`);

    const fields: string[] = [];

    for (const m of e.methods ?? []) {
      const fieldName = `_method_${sanitizeHaskellId(m.name)}`;
      // Store sig without outer quotes so parser can handle it cleanly
      const sig = `${renderParamSig(m.params)} -> ${m.returnType ?? 'void'}`;
      fields.push(`  { ${fieldName} :: ${sig}`);
    }

    const byType = relsByFrom.get(e.id);
    if (byType) {
      for (const [relType, targets] of byType) {
        const fieldName = `_rel_${sanitizeHaskellId(relType)}`;
        const targetList = targets.join(', ');
        fields.push(`  , ${fieldName} :: [${targetList}]`);
      }
    }

    if (fields.length > 0) {
      // Fix first field: if starts with "  , " it should start with "  { "
      // Already handled above — first field uses "  { " prefix
      // But if first field is a relation (no method fields), the first element starts with "  , "
      // Normalise:
      const first = fields[0];
      if (first !== undefined && first.startsWith('  , ')) {
        fields[0] = '  { ' + first.slice(4);
      }
      lines.push(fields.join('\n'));
      lines.push('  }');
    } else {
      lines.push('  {}');
    }

    blocks.push(lines.join('\n'));
  }

  if (orphanedRelations.length > 0) {
    const orphanLines = ['-- ORPHANED_RELATIONS'];
    for (const r of orphanedRelations) {
      orphanLines.push(`-- rel: ${r.from} ${r.type} ${r.to}`);
    }
    blocks.push(orphanLines.join('\n'));
  }

  return blocks.join('\n\n');
}
