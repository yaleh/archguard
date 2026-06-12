import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

// Parse a markdown table body (skipping header and separator rows) into rows of trimmed cells.
function parseTableRows(block: string): string[][] {
  return block
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .slice(2) // skip header + separator
    .map(line =>
      line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim()),
    )
    .filter(cells => cells.length > 0 && cells.some(c => c !== ''));
}

// Parse "name(p1:t1, p2:t2) -> returnType" method signature string.
// returnType may contain <> chars.
function parseMethodSig(sig: string): CMethod {
  const m = sig.match(/^(\S+)\(([^)]*)\)\s*->\s*(.+)$/);
  if (!m) {
    throw new Error(`markdown-table: cannot parse method signature: "${sig.slice(0, 80)}"`);
  }
  const name = m[1] ?? '';
  const paramsStr = m[2] ?? '';
  const returnType = (m[3] ?? 'void').trim();
  if (!name) throw new Error(`markdown-table: empty method name in signature: "${sig}"`);

  const params: CParam[] = paramsStr
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const parts = p.split(':').map(s => s.trim());
      const pname = parts[0] ?? p;
      const ptype = parts[1] ?? 'unknown';
      return { name: pname, type: ptype };
    });
  return { name, params, returnType };
}

export function parse(text: string): C {
  // Locate headers early so we can use them for block slicing.
  const entityHeaderLine = text.match(/\|\s*id\s*\|[^\n]+/i)?.[0] ?? '';
  const relationHeaderLine = text.match(/\|\s*from\s*\|[^\n]+/i)?.[0] ?? '';

  if (!entityHeaderLine) {
    throw new Error('markdown-table: could not locate entity table (expected header with id, ..., methods)');
  }
  if (!relationHeaderLine) {
    throw new Error('markdown-table: could not locate relation table (expected header with from, to, type)');
  }

  // Parse entity table header to determine column indices.
  const entityHeaderCells = entityHeaderLine
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim().toLowerCase());

  const eIdIdx = entityHeaderCells.findIndex(c => c === 'id');
  const eNameIdx = entityHeaderCells.findIndex(c => c === 'name');
  const eTypeIdx = entityHeaderCells.findIndex(c => c === 'type');
  const eSrcIdx = entityHeaderCells.findIndex(c => c === 'sourcefile' || c === 'source_file' || c === 'source');
  const eMethodsIdx = entityHeaderCells.findIndex(c => c === 'methods');

  if (eIdIdx === -1 || eNameIdx === -1 || eTypeIdx === -1 || eMethodsIdx === -1) {
    throw new Error('markdown-table: entity table must have columns: id, name, type, methods');
  }

  // Extract entity block — stop before the relation table to avoid relation header rows
  // being parsed as entity rows.
  const entityBlockStart = text.indexOf(entityHeaderLine);
  const relationsHeaderPos = text.indexOf(relationHeaderLine);
  const entityBlock =
    relationsHeaderPos > entityBlockStart
      ? text.slice(entityBlockStart, relationsHeaderPos)
      : text.slice(entityBlockStart);

  const entityRows = parseTableRows(entityBlock);
  const entities: CEntity[] = entityRows.map(cells => {
    const id = cells[eIdIdx] ?? '';
    const name = cells[eNameIdx] ?? '';
    const type = cells[eTypeIdx] ?? '';
    const sourceFile = eSrcIdx >= 0 ? (cells[eSrcIdx] ?? 'unknown') : 'unknown';
    const methodsCell = cells[eMethodsIdx] ?? '';

    if (!id || !name || !type) {
      throw new Error(`markdown-table: entity row missing id/name/type: ${JSON.stringify(cells)}`);
    }

    const methods: CMethod[] =
      methodsCell === '' || methodsCell === '-'
        ? []
        : methodsCell.split(/;\s*/).filter(s => s.length > 0).map(parseMethodSig);

    return {
      id: normalizeId(id),
      name,
      type: type as EntityType,
      sourceFile: sourceFile || 'unknown',
      methods,
    };
  });

  // Parse relation table header to determine column indices.
  const relationHeaderCells = relationHeaderLine
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim().toLowerCase());

  const rFromIdx = relationHeaderCells.findIndex(c => c === 'from');
  const rToIdx = relationHeaderCells.findIndex(c => c === 'to');
  const rTypeIdx = relationHeaderCells.findIndex(c => c === 'type');

  if (rFromIdx === -1 || rToIdx === -1 || rTypeIdx === -1) {
    throw new Error('markdown-table: relation table must have columns: from, to, type');
  }

  const relationBlockStart = text.indexOf(relationHeaderLine);
  const relationBlock = text.slice(relationBlockStart);
  const relationRows = parseTableRows(relationBlock);

  const relations: CRelation[] = relationRows.map(cells => {
    const from = cells[rFromIdx] ?? '';
    const to = cells[rToIdx] ?? '';
    const type = cells[rTypeIdx] ?? '';
    if (!from || !to || !type) {
      throw new Error(`markdown-table: relation row missing from/to/type: ${JSON.stringify(cells)}`);
    }
    return {
      from: normalizeId(from),
      to: normalizeId(to),
      type: type as RelationType,
    };
  });

  return { entities, relations };
}
