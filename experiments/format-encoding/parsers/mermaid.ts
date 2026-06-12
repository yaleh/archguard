import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

function parseMethodLine(line: string): CMethod | null {
  const stripped = line.replace(/^[+\-#~]\s*/, '').trim();
  const m = stripped.match(/^(\w+)\(([^)]*)\)\s*(.+)?$/);
  if (!m) return null;
  const name = m[1] ?? '';
  const paramsStr = m[2] ?? '';
  const returnType = (m[3] ?? 'void').trim();
  if (!name) return null;

  const params: CParam[] = paramsStr
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const parts = p.trim().split(/\s+/);
      const pname = parts[0] ?? p;
      const ptype = parts[1] ?? 'unknown';
      return { name: pname, type: ptype };
    });
  return { name, params, returnType };
}

export function parse(text: string): C {
  const lines = text.split('\n').map(l => l.trim());

  const firstLine = lines.find(l => l.length > 0 && !l.startsWith('%%'));
  if (!firstLine || !firstLine.startsWith('classDiagram')) {
    throw new Error('mermaid: text does not begin with "classDiagram"');
  }

  // Parse id-map, name-map, source-map comment lines
  const aliasToId = new Map<string, string>();
  const aliasToName = new Map<string, string>();
  const aliasToSource = new Map<string, string>();
  for (const line of lines) {
    const idM = line.match(/^%%\s+id:\s+(\S+)=(.+)$/);
    if (idM) aliasToId.set(idM[1]!, idM[2]!.trim());
    const nameM = line.match(/^%%\s+name:\s+(\S+)=(.+)$/);
    if (nameM) aliasToName.set(nameM[1]!, nameM[2]!.trim());
    const srcM = line.match(/^%%\s+source:\s+(\S+)=(.+)$/);
    if (srcM) aliasToSource.set(srcM[1]!, srcM[2]!.trim());
  }

  const entityMap = new Map<string, { methods: CMethod[]; sourceFile: string; type: EntityType }>();
  const relations: CRelation[] = [];

  // Arrow pattern: "Alias ArrowToken Alias : label" or without label
  const arrowRe = /^(\w+)\s+(\.\.>\s*|--\|>\s*|\.\.\|>\s*|\*--\s*|o--\s*|-->|\.\.>|--)\s*(\w+)(?:\s*:\s*(\S+))?/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('%%') || line === 'classDiagram') { i++; continue; }

    const classBlockMatch = line.match(/^class\s+(\w+)\s*\{/);
    if (classBlockMatch) {
      const alias = classBlockMatch[1] ?? '';
      if (!alias) { i++; continue; }
      if (!entityMap.has(alias)) {
        entityMap.set(alias, { methods: [], sourceFile: 'unknown', type: 'class' });
      }
      const entry = entityMap.get(alias)!;
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '}') {
        const inner = (lines[i] ?? '').trim();
        const stereoMatch = inner.match(/^<<(\w+)>>$/);
        if (stereoMatch) {
          const stereo = (stereoMatch[1] ?? '').toLowerCase();
          if (stereo === 'interface') entry.type = 'interface';
          else if (stereo === 'enum') entry.type = 'enum';
          else if (stereo === 'function') entry.type = 'function';
          else if (stereo === 'type') entry.type = 'type';
        } else if (inner.length > 0) {
          const method = parseMethodLine(inner);
          if (method) entry.methods.push(method);
        }
        i++;
      }
      i++;
      continue;
    }

    const classBareMatch = line.match(/^class\s+(\w+)$/);
    if (classBareMatch) {
      const alias = classBareMatch[1] ?? '';
      if (alias && !entityMap.has(alias)) {
        entityMap.set(alias, { methods: [], sourceFile: 'unknown', type: 'class' });
      }
      i++;
      continue;
    }

    const arrowMatch = line.match(arrowRe);
    if (arrowMatch) {
      const lhsAlias = arrowMatch[1] ?? '';
      const arrowRaw = (arrowMatch[2] ?? '').trim();
      const rhsAlias = arrowMatch[3] ?? '';
      const label = arrowMatch[4] ?? '';
      if (!lhsAlias || !rhsAlias) { i++; continue; }

      // Do NOT create entityMap entries for relation endpoints — only class declarations produce entities.
      // Orphaned relation from-IDs (not in aliasToId) round-trip through the alias with normalizeId.

      // Relation type: use label if it's a valid RelationType, otherwise infer from arrow
      const VALID_REL_TYPES = new Set<string>(['call', 'inheritance', 'composition', 'aggregation', 'dependency', 'implementation']);
      let relType: RelationType;
      if (label && VALID_REL_TYPES.has(label)) {
        relType = label as RelationType;
      } else {
        const ARROW_MAP: Record<string, RelationType> = {
          '--|>': 'inheritance', '..|>': 'implementation', '*--': 'composition',
          'o--': 'aggregation', '-->': 'call', '..>': 'dependency', '--': 'dependency',
        };
        relType = ARROW_MAP[arrowRaw] ?? 'dependency';
      }

      const fromId = aliasToId.get(lhsAlias) ?? lhsAlias;
      const toId = aliasToId.get(rhsAlias) ?? rhsAlias;
      relations.push({ from: normalizeId(fromId), to: normalizeId(toId), type: relType });
      i++;
      continue;
    }

    i++;
  }

  if (entityMap.size === 0) {
    throw new Error('mermaid: no classes found in classDiagram');
  }

  const entities: CEntity[] = Array.from(entityMap.entries()).map(([alias, data]) => {
    const originalId = aliasToId.get(alias) ?? alias;
    const originalName = aliasToName.get(alias) ?? alias;
    const sourceFile = aliasToSource.get(alias) ?? data.sourceFile;
    return {
      id: normalizeId(originalId),
      name: originalName,
      type: data.type,
      sourceFile,
      methods: data.methods,
    };
  });

  return { entities, relations };
}
