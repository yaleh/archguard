import { readFile } from 'node:fs/promises';
import type { C, CEntity, CMethod, CParam, CRelation, EntityType, RelationType } from './schema.js';
import { normalizeId } from './schema.js';

export interface ArchJsonParam {
  name: string;
  type: string;
}

// Actual ArchGuard member (can be method or field)
export interface ArchJsonMember {
  name: string;
  type: 'method' | 'field' | string;
  parameters?: ArchJsonParam[];
  returnType?: string;
  // legacy flat format
  params?: ArchJsonParam[];
}

export interface ArchJsonSourceLocation {
  file: string;
  startLine?: number;
}

export interface ArchJsonEntity {
  id?: string;
  name: string;
  type: string;
  // actual ArchGuard format
  members?: ArchJsonMember[];
  sourceLocation?: ArchJsonSourceLocation;
  // legacy flat format
  methods?: Array<{ name: string; params?: ArchJsonParam[]; returnType?: string }>;
  sourceFile?: string;
}

export interface ArchJsonRelation {
  // actual ArchGuard format
  source?: string;
  target?: string;
  // legacy flat format
  from?: string;
  to?: string;
  type: string;
}

export interface ArchJson {
  entities: ArchJsonEntity[];
  relations?: ArchJsonRelation[];
}

// Simplify complex TypeScript/Python types to experiment-safe forms.
// Removes chars that break text-format parsers while preserving meaningful names.
function simplifyType(t: string): string {
  if (!t) return t;
  // 1. Strip import("..."). prefixes
  t = t.replace(/import\([^)]+\)\./g, '');
  // 2. String literal types "foo" → string
  t = t.replace(/"[^"]*"/g, 'string').replace(/'[^']*'/g, 'string');
  // 3. Object literal types { ... } → object (strip nested {})
  let prev = '';
  while (prev !== t) { prev = t; t = t.replace(/\{[^{}]*\}/g, 'object'); }
  // 4. Union A | B → take first member; Intersection A & B → take first member.
  //    Both reduce multi-part types to a single safe token.
  if (t.includes('|')) { t = t.split('|')[0]!.trim(); }
  if (t.includes('&')) { t = t.split('&')[0]!.trim(); }
  // 5. Function types: (params) => T → Fn_ (removes parens that break method sig parsers)
  let fnPrev = '';
  while (fnPrev !== t) { fnPrev = t; t = t.replace(/\([^()]*\)\s*=>\s*/g, 'Fn_'); }
  // 5b. Semicolons (TypeScript object types): remove
  t = t.replace(/;/g, '');
  // 6. Replace commas (and trailing spaces) inside any bracket nesting <> or [] with _ using a char scan.
  //    "Omit<RenderJob, string>" → "Omit<RenderJob_string>" (no space after _ avoids mermaid split issues).
  let out = '';
  let depth = 0;
  let skipSpaceAfterComma = false;
  for (const ch of t) {
    if (ch === '<' || ch === '[') { depth++; out += ch; skipSpaceAfterComma = false; }
    else if (ch === '>' || ch === ']') { depth = Math.max(0, depth - 1); out += ch; skipSpaceAfterComma = false; }
    else if (ch === ',' && depth > 0) { out += '_'; skipSpaceAfterComma = true; }
    else if (ch === ' ' && skipSpaceAfterComma && depth > 0) { /* skip space(s) immediately after comma inside brackets */ }
    else { out += ch; skipSpaceAfterComma = false; }
  }
  t = out;
  // 7. Replace all remaining [...] bracket groups with safe tokens:
  //    [] (array suffix) → _arr  |  [K] (indexed access) → _K_
  //    This must run AFTER the comma→_ scan so [K_V] types are already normalised.
  //    Applied iteratively to handle nested cases.
  let brackPrev = '';
  while (brackPrev !== t) {
    brackPrev = t;
    t = t.replace(/\[([^\[\]]*)\]/g, (_, inner: string) => inner ? `_${inner}_` : '_arr');
  }
  // 8. Clean up extra whitespace
  return t.replace(/\s+/g, ' ').trim();
}

const VALID_ENTITY_TYPES = new Set<string>(['class', 'interface', 'function', 'enum', 'type']);

// Maps ArchGuard relation types to C relation types
const RELATION_TYPE_MAP: Record<string, RelationType> = {
  call: 'call',
  extend: 'inheritance',
  inheritance: 'inheritance',
  implement: 'implementation',
  implementation: 'implementation',
  composition: 'composition',
  aggregation: 'aggregation',
  dependency: 'dependency',
  import: 'dependency',
};

function mapEntityType(raw: string): EntityType {
  const lower = raw.toLowerCase();
  if (VALID_ENTITY_TYPES.has(lower)) {
    return lower as EntityType;
  }
  return 'type';
}

function mapRelationType(raw: string): RelationType | null {
  return RELATION_TYPE_MAP[raw.toLowerCase()] ?? null;
}

function extractMethods(raw: ArchJsonEntity): CMethod[] {
  // Actual ArchGuard format: members[] where type === 'method'
  if (raw.members && raw.members.length > 0) {
    return raw.members
      .filter((m) => m.type === 'method')
      .map((m): CMethod => {
        const params: CParam[] = (m.parameters ?? m.params ?? []).map((p): CParam => ({
          name: p.name,
          type: simplifyType(p.type),
        }));
        return { name: m.name, params, returnType: simplifyType(m.returnType ?? 'void') };
      });
  }
  // Legacy flat format: methods[]
  if (raw.methods && raw.methods.length > 0) {
    return raw.methods.map((m): CMethod => {
      const params: CParam[] = (m.params ?? []).map((p): CParam => ({
        name: p.name,
        type: simplifyType(p.type),
      }));
      return { name: m.name, params, returnType: simplifyType(m.returnType ?? 'void') };
    });
  }
  return [];
}

function extractSourceFile(raw: ArchJsonEntity): string {
  if (raw.sourceLocation?.file) return raw.sourceLocation.file;
  if (raw.sourceFile) return raw.sourceFile;
  return 'unknown';
}

function extractEntityId(raw: ArchJsonEntity): string {
  // Use ArchGuard's own id if present, otherwise normalizeId(name)
  if (raw.id) return normalizeId(raw.id);
  return normalizeId(raw.name);
}

export function archJsonToC(archJson: ArchJson): C {
  const entities: CEntity[] = archJson.entities.map((raw): CEntity => ({
    id: extractEntityId(raw),
    name: raw.name,
    type: mapEntityType(raw.type),
    sourceFile: extractSourceFile(raw),
    methods: extractMethods(raw),
  }));

  const relations: CRelation[] = (archJson.relations ?? []).reduce<CRelation[]>((acc, raw) => {
    const relationType = mapRelationType(raw.type);
    if (relationType !== null) {
      const from = normalizeId(raw.source ?? raw.from ?? '');
      const to = normalizeId(raw.target ?? raw.to ?? '');
      // Filter out relations with non-entity targets (spaces indicate TypeScript type expressions,
      // not entity IDs — e.g. "readonly string", "readonly [\"package\", \"class\"]").
      if (from && to && !from.includes(' ') && !to.includes(' ')) {
        acc.push({ from, to, type: relationType });
      }
    }
    return acc;
  }, []);

  return { entities, relations };
}

export async function loadCorpusFromFile(path: string): Promise<C[]> {
  const content = await readFile(path, 'utf-8');
  const parsed: unknown = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return (parsed as ArchJson[]).map(archJsonToC);
  }

  // Single ArchJson object
  return [archJsonToC(parsed as ArchJson)];
}
