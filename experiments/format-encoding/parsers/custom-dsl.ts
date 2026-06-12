import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

// Parse a param list string "p1:t1, p2:t2" into CParam[].
function parseParams(paramsStr: string): CParam[] {
  return paramsStr
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const idx = p.indexOf(':');
      if (idx === -1) return { name: p, type: 'unknown' };
      return { name: p.slice(0, idx).trim(), type: p.slice(idx + 1).trim() };
    });
}

export function parse(text: string): C {
  const lines = text.split('\n').map(l => l.trim());

  const entities: CEntity[] = [];
  const relations: CRelation[] = [];

  // Regex patterns.
  // Support optional "name:<original>" suffix: entity <id> :: <type> @ <source> name:<name>
  const entityDeclRe = /^entity\s+(\S+)\s*::\s*(\S+)\s*@\s*(\S+)(?:\s+name:(\S+))?$/;
  // Method line: "method name(params) -> returnType" where returnType may contain <> chars
  const methodLineRe = /^method\s+(\S+)\(([^)]*)\)\s*->\s*(.+)$/;
  const relationLineRe = /^(\S+)\s*-(\S+)->\s*(\S+)$/;

  // Track the current entity being built (accumulates method lines).
  let currentEntity: CEntity | null = null;

  const flushCurrent = () => {
    if (currentEntity) {
      entities.push(currentEntity);
      currentEntity = null;
    }
  };

  for (const line of lines) {
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    const entityMatch = line.match(entityDeclRe);
    if (entityMatch) {
      flushCurrent();
      const id = entityMatch[1] ?? '';
      const type = entityMatch[2] ?? 'class';
      const sourceFile = entityMatch[3] ?? 'unknown';
      const originalName = entityMatch[4] ?? id;
      if (!id) throw new Error(`custom-dsl: entity declaration missing id: "${line}"`);
      currentEntity = {
        id: normalizeId(id),
        name: originalName,
        type: type as EntityType,
        sourceFile,
        methods: [],
      };
      continue;
    }

    const methodMatch = line.match(methodLineRe);
    if (methodMatch) {
      if (!currentEntity) {
        throw new Error(`custom-dsl: method line outside entity block: "${line}"`);
      }
      const name = methodMatch[1] ?? '';
      const paramsStr = methodMatch[2] ?? '';
      const returnType = methodMatch[3] ?? 'void';
      if (!name) throw new Error(`custom-dsl: empty method name in: "${line}"`);
      currentEntity.methods.push({ name, params: parseParams(paramsStr), returnType });
      continue;
    }

    const relMatch = line.match(relationLineRe);
    if (relMatch) {
      flushCurrent();
      const from = relMatch[1] ?? '';
      const relType = relMatch[2] ?? '';
      const to = relMatch[3] ?? '';
      if (!from || !relType || !to) throw new Error(`custom-dsl: malformed relation line: "${line}"`);
      relations.push({
        from: normalizeId(from),
        to: normalizeId(to),
        type: relType as RelationType,
      });
      continue;
    }

    // Unrecognised non-blank line: ignore gracefully (tolerant parsing).
  }

  flushCurrent();

  if (entities.length === 0) {
    throw new Error('custom-dsl: no entity declarations found');
  }

  return { entities, relations };
}
