import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

// Parse a _method_ field signature in the form "(p1:t1, p2:t2) -> returnType"
// or "()" -> returnType" (no params).
function parseMethodSignature(name: string, signature: string): CMethod {
  // Strip surrounding quotes if present
  const sig = signature.trim().replace(/^"(.*)"$/, '$1').trim();

  // Match "(params) -> returnType" — arrow may have spaces around it
  const m = sig.match(/^\((.*?)\)\s*->\s*(.+)$/s);
  if (!m) {
    // Fallback: treat entire sig as returnType with no params
    return { name, params: [], returnType: sig || 'void' };
  }

  const paramsStr = (m[1] ?? '').trim();
  const returnType = (m[2] ?? 'void').trim();

  const params: CParam[] = paramsStr.length === 0
    ? []
    : paramsStr.split(',').map(p => {
        const idx = p.indexOf(':');
        if (idx === -1) return { name: p.trim(), type: 'unknown' };
        return { name: p.slice(0, idx).trim(), type: p.slice(idx + 1).trim() };
      });

  return { name, params, returnType };
}

// Parse a _rel_ target list: "[Target1, Target2, ...]"
function parseTargetList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export function parse(text: string): C {
  const lines = text.split('\n');

  const entities: CEntity[] = [];
  const relations: CRelation[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();

    if (line.startsWith('-- |') || line.startsWith('data ')) {
      // Collect the comment block.
      const commentLines: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j] ?? '').trim().startsWith('-- |')) {
        commentLines.push((lines[j] ?? '').trim());
        j++;
      }

      // Extract id and source from comment lines.
      let entityId = '';
      let entityOriginalName = '';
      let sourceFile = 'unknown';
      for (const cl of commentLines) {
        const idMatch = cl.match(/--\s*\|\s*id:\s*(\S+)/);
        if (idMatch) entityId = idMatch[1] ?? '';
        const nameMatch = cl.match(/--\s*\|\s*name:\s*(\S+)/);
        if (nameMatch) entityOriginalName = nameMatch[1] ?? '';
        const srcMatch = cl.match(/--\s*\|\s*source:\s*(\S+)/);
        if (srcMatch) sourceFile = srcMatch[1] ?? 'unknown';
      }

      // After comments, expect the data line.
      const dataLine = (lines[j] ?? '').trim();
      const dataMatch = dataLine.match(/^data\s+(\w[\w.]*)\s*::\s*(\w+)\s*=/);
      if (!dataMatch) {
        // Not a data declaration we recognise — skip.
        i = commentLines.length > 0 ? j + 1 : i + 1;
        continue;
      }

      const haskellTypeName = dataMatch[1] ?? '';
      const entityTypeRaw = dataMatch[2] ?? 'class';
      if (!haskellTypeName) { i = j + 1; continue; }
      if (!entityId) entityId = haskellTypeName;
      // Use stored original name if available; fall back to Haskell type name
      const entityName = entityOriginalName || haskellTypeName;

      const methods: CMethod[] = [];
      const relFields: Map<string, string[]> = new Map();

      // Collect record fields from subsequent lines until a blank line or new top-level declaration.
      let k = j + 1;
      while (k < lines.length) {
        const fieldLine = (lines[k] ?? '').trim();
        // Stop at blank line or new top-level item.
        if (
          fieldLine === '' ||
          fieldLine.startsWith('data ') ||
          (fieldLine.startsWith('-- |') && !fieldLine.includes('::'))
        ) {
          break;
        }
        // Strip leading '{', ',', '}' characters used in Haskell record syntax.
        const cleaned = fieldLine.replace(/^[{,}\s]+/, '').replace(/[,}\s]+$/, '').trim();

        // Method field: _method_<name> :: <signature>
        const methodMatch = cleaned.match(/^_method_(\w+)\s*::\s*(.+)$/);
        if (methodMatch) {
          const mName = methodMatch[1] ?? '';
          const sig = (methodMatch[2] ?? '').trim();
          if (mName) methods.push(parseMethodSignature(mName, sig));
          k++;
          continue;
        }

        // Relation field: _rel_<relType> :: [<targets>]
        const relMatch = cleaned.match(/^_rel_(\w+)\s*::\s*(\[.+\])$/);
        if (relMatch) {
          const relType = relMatch[1] ?? '';
          const targetsRaw = relMatch[2] ?? '[]';
          if (relType) {
            const targets = parseTargetList(targetsRaw);
            relFields.set(relType, (relFields.get(relType) ?? []).concat(targets));
          }
          k++;
          continue;
        }

        k++;
      }

      entities.push({
        id: normalizeId(entityId),
        name: entityName,
        type: entityTypeRaw as EntityType,
        sourceFile,
        methods,
      });

      // Emit relations.
      for (const [relType, targets] of relFields.entries()) {
        for (const target of targets) {
          relations.push({
            from: normalizeId(entityId),
            to: normalizeId(target),
            type: relType as RelationType,
          });
        }
      }

      i = k;
      continue;
    }

    i++;
  }

  // Parse orphaned relations section: "-- rel: <from> <type> <to>"
  let inOrphaned = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '-- ORPHANED_RELATIONS') { inOrphaned = true; continue; }
    if (inOrphaned) {
      const m = trimmed.match(/^--\s+rel:\s+(\S+)\s+(\S+)\s+(\S+)$/);
      if (m) {
        relations.push({
          from: normalizeId(m[1] ?? ''),
          to: normalizeId(m[3] ?? ''),
          type: (m[2] ?? 'dependency') as RelationType,
        });
      }
    }
  }

  if (entities.length === 0) {
    throw new Error('haskell-adt: no data declarations found');
  }

  return { entities, relations };
}
