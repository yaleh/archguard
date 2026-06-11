/**
 * Minimal ArchJSON + call-graph reading helpers shared by probes.ts and
 * predict.ts (Phase 61). Field subset of the real `analyze -f json` output;
 * unknown fields are carried through untouched.
 */
import type { CallEdge } from '../../callgraph';

export interface ArchParameter {
  name: string;
  type?: string;
  isOptional?: boolean;
}

export interface ArchMember {
  name: string;
  /** 'method' | 'property' | 'field' | 'constructor' (open set). */
  type: string;
  visibility?: string;
  fieldType?: string;
  returnType?: string;
  parameters?: ArchParameter[];
  isStatic?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;
}

export interface ArchEntity {
  id: string;
  name: string;
  /** 'class' | 'interface' | 'function' | ... (open set). */
  type: string;
  visibility?: string;
  members?: ArchMember[];
  sourceLocation?: { file: string; startLine?: number; endLine?: number };
  [key: string]: unknown;
}

export interface ArchRelation {
  id?: string;
  type: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface ArchJsonDoc {
  entities: ArchEntity[];
  relations: ArchRelation[];
  callGraph?: { edges: CallEdge[]; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Strip TS compiler-resolved `import("/abs/path/...").Name` type prefixes.
 * The raw query arch.json carries absolute repo paths inside member types —
 * a de-obfuscation leak (the path reveals the real project). `import("…").X`
 * → `X`. Works on raw JSON text (escaped quotes) and plain strings alike.
 */
export function sanitizeImportTypes(text: string): string {
  return text.replace(/import\(\\?"[^"]*"\)\./g, '');
}

/** Package of a source file = its directory ('.' for top-level files). */
export function packageOfFile(file: string): string {
  const norm = file.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? '.' : norm.slice(0, idx);
}

/** Does a relation involve the entity (by id or bare name on either end)? */
export function relationInvolves(entity: ArchEntity, relation: ArchRelation): boolean {
  return (
    relation.source === entity.id ||
    relation.target === entity.id ||
    relation.source === entity.name ||
    relation.target === entity.name
  );
}

/** Owner identifier of a qualified call-graph endpoint `file#Owner.member`. */
export function ownerOfQualified(qualified: string): string {
  const hash = qualified.indexOf('#');
  const member = hash < 0 ? qualified : qualified.slice(hash + 1);
  const dot = member.indexOf('.');
  return dot < 0 ? member : member.slice(0, dot);
}

/** Does a call edge involve the entity (as source or target owner)? */
export function callEdgeInvolves(entity: ArchEntity, edge: CallEdge): boolean {
  return (
    ownerOfQualified(edge.source) === entity.name || ownerOfQualified(edge.target) === entity.name
  );
}
