import { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType, normalizeId } from '../lib/schema.js';

// Parse "name(p1:t1, p2:t2) -> returnType" — returnType may include <> chars.
function parseMethodSig(sig: string): CMethod {
  // name(params) -> returnType — allow returnType to be anything after " -> "
  const m = sig.trim().match(/^(\w+)\(([^)]*)\)\s*->\s*(.+)$/);
  if (!m) {
    throw new Error(`nl-exhaustive: cannot parse method signature: "${sig.slice(0, 80)}"`);
  }
  const name = m[1] ?? '';
  const paramsStr = m[2] ?? '';
  const returnType = (m[3] ?? 'void').trim();
  if (!name) throw new Error(`nl-exhaustive: empty method name in: "${sig}"`);

  const params: CParam[] = paramsStr
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const colonIdx = p.indexOf(':');
      if (colonIdx !== -1) {
        return { name: p.slice(0, colonIdx).trim(), type: p.slice(colonIdx + 1).trim() };
      }
      const parts = p.split(/\s+/);
      const pname = parts[0] ?? p;
      const ptype = parts[1] ?? 'unknown';
      return { name: pname, type: ptype };
    });
  return { name, params, returnType };
}

export function parse(text: string): C {
  const entities: CEntity[] = [];
  const relations: CRelation[] = [];

  // Entity sentence pattern:
  // "Entity <Name> (id: <id>) of type <type> defined in <sourceFile>."
  const entityRe = /Entity\s+(\S+)\s+\(id:\s*([^)]+)\)\s+of\s+type\s+(\S+)\s+defined\s+in\s+(\S+)\./g;

  // Relation sentence pattern: "<fromId> <relType> <toId>."
  // IDs may contain slashes, dots, underscores etc.
  const relationRe =
    /(\S+)\s+(call|inheritance|composition|aggregation|dependency|implementation)\s+(\S+)\.\s/g;

  // Extract entities and their methods.
  const entityMatches: { match: RegExpExecArray; methodsText: string }[] = [];
  let em: RegExpExecArray | null;
  entityRe.lastIndex = 0;
  while ((em = entityRe.exec(text)) !== null) {
    entityMatches.push({ match: em, methodsText: '' });
  }

  // For each entity, extract the Methods block from the text slice following the entity sentence.
  for (let idx = 0; idx < entityMatches.length; idx++) {
    const entry = entityMatches[idx];
    if (!entry) continue;
    const matchIndex = entry.match.index ?? 0;
    const matchLength = entry.match[0]?.length ?? 0;
    const start = matchIndex + matchLength;
    const nextEntry = entityMatches[idx + 1];
    const end = nextEntry !== undefined ? (nextEntry.match.index ?? text.length) : text.length;
    const slice = text.slice(start, end);
    const methodsMatch = /Methods:\s*\[([^\]]*)\]/.exec(slice);
    if (methodsMatch) {
      entry.methodsText = methodsMatch[1] ?? '';
    }
  }

  for (const { match, methodsText } of entityMatches) {
    const name = match[1] ?? '';
    const id = match[2] ?? '';
    const type = match[3] ?? '';
    const sourceFile = match[4] ?? 'unknown';

    if (!name || !id || !type) {
      throw new Error(`nl-exhaustive: entity sentence missing name/id/type: "${match[0] ?? ''}"`);
    }

    const trimmedMethods = methodsText.trim();
    const methods: CMethod[] = trimmedMethods.length === 0
      ? []
      : trimmedMethods
          .split(/;\s*/)
          .map(s => s.trim())
          .filter(s => s.length > 0)
          .map(parseMethodSig);

    entities.push({
      id: normalizeId(id),
      name,
      type: type as EntityType,
      sourceFile,
      methods,
    });
  }

  if (entities.length === 0) {
    throw new Error('nl-exhaustive: no entity sentences found');
  }

  // Extract relations.
  let rm: RegExpExecArray | null;
  relationRe.lastIndex = 0;
  while ((rm = relationRe.exec(text)) !== null) {
    const from = rm[1] ?? '';
    const relType = rm[2] ?? '';
    const to = rm[3] ?? '';
    if (!from || !relType || !to) continue;
    relations.push({
      from: normalizeId(from),
      to: normalizeId(to),
      type: relType as RelationType,
    });
  }

  return { entities, relations };
}
