/**
 * Stage 61.2 — anchor × 6-level probe serialization D_ℓ(a) (proposal §8.1).
 *
 * Anchor set = ALL entities of the L4 ArchJSON (callGraph already injected by
 * inject-callgraph.ts). For each anchor a and level ℓ the probe D_ℓ(a) is:
 *
 *   L0  anchor's (obfuscated) file name;
 *   L1  anchor's package + every package-level edge of that package
 *       (parsed from the L1 package flowchart .mmd);
 *   L2  declaration + PUBLIC members + entity-level relations involving a;
 *   L3  L2 + private members + call edges involving a;
 *   L4  ArchJSON entity object + relations + callGraph entries involving a;
 *   L5  a's complete obfuscated source (sliced from obf/ by sourceLocation).
 *
 * Every probe contains the anchor's obfuscated identifier (§1 R3 guard
 * against L1 same-package degeneration). Output is JSONL + a metadata file
 * with the actual K; serialization is fully deterministic (same inputs →
 * byte-identical output, no clocks, no randomness).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CallEdge } from './callgraph';
import {
  callEdgeInvolves,
  packageOfFile,
  relationInvolves,
  sanitizeImportTypes,
  type ArchEntity,
  type ArchJsonDoc,
  type ArchMember,
} from './lib/levels/archjson';
import { LEVELS_DIR } from './lib/paths';

export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type Level = (typeof LEVELS)[number];

export interface ProbeRecord {
  anchor: string;
  entityId: string;
  level: Level;
  text: string;
}

export interface ProbeMeta {
  schema: 'probes-meta-v1';
  /** Actual anchor count (frozen-record cross-check, §8.1). */
  K: number;
  levels: readonly Level[];
  recordCount: number;
  perLevel: Record<Level, { count: number; meanChars: number }>;
  anchors: string[];
}

// ---------------------------------------------------------------------------
// L1 package flowchart parsing
// ---------------------------------------------------------------------------

export interface PackageEdge {
  from: string;
  to: string;
  label?: string;
}

const NODE_RE = /^\s*([A-Za-z0-9_]+)\["([^"]*)"\]/;
const EDGE_RE = /^\s*([A-Za-z0-9_]+)\s*[=.-]+>\s*(?:\|"?([^"|]*)"?\|\s*)?([A-Za-z0-9_]+)\s*$/;

/**
 * Parse node labels + edges out of the package-level flowchart .mmd.
 * Legend / style / classDef / subgraph lines are ignored.
 */
export function parsePackageMermaid(text: string): PackageEdge[] {
  const labels = new Map<string, string>();
  const edges: PackageEdge[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (
      line.startsWith('%%') ||
      line.startsWith('subgraph') ||
      line.startsWith('style') ||
      line.startsWith('classDef') ||
      line.startsWith('direction') ||
      line.startsWith('end')
    ) {
      continue;
    }
    const node = NODE_RE.exec(line);
    if (node !== null && !line.includes('>')) {
      labels.set(node[1]!, node[2]!);
      continue;
    }
    const edge = EDGE_RE.exec(line);
    if (edge !== null) {
      const from = edge[1]!;
      const to = edge[3]!;
      if (from.startsWith('legend') || to.startsWith('legend')) continue;
      edges.push({
        from: labels.get(from) ?? from,
        to: labels.get(to) ?? to,
        ...(edge[2] !== undefined ? { label: edge[2] } : {}),
      });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Member / relation / call-edge formatting
// ---------------------------------------------------------------------------

const VISIBILITY_SYMBOL: Record<string, string> = {
  public: '+',
  private: '-',
  protected: '#',
};

export function formatMember(m: ArchMember): string {
  const vis = VISIBILITY_SYMBOL[m.visibility ?? 'public'] ?? '+';
  const mods = `${m.isStatic === true ? 'static ' : ''}${m.isAsync === true ? 'async ' : ''}`;
  if (m.type === 'method' || m.type === 'constructor') {
    const params = (m.parameters ?? [])
      .map((p) => `${p.name}${p.isOptional === true ? '?' : ''}: ${p.type ?? 'any'}`)
      .join(', ');
    const ret = m.returnType !== undefined ? `: ${m.returnType}` : '';
    return `${vis}${mods}${m.name}(${params})${ret}`;
  }
  return `${vis}${mods}${m.name}: ${m.fieldType ?? 'any'}`;
}

function isPublicMember(m: ArchMember): boolean {
  return m.visibility === undefined || m.visibility === 'public';
}

function formatCallEdge(e: CallEdge): string {
  const tag = e.viaInterface ? `${e.kind} viaInterface` : e.kind;
  return `${e.source} -[${tag}]-> ${e.target}`;
}

// ---------------------------------------------------------------------------
// Per-level serialization
// ---------------------------------------------------------------------------

export interface ProbeContext {
  arch: ArchJsonDoc;
  /** Package-level edges parsed from the L1 .mmd. */
  packageEdges: PackageEdge[];
  /** Directory that sourceLocation.file paths are relative to (obf tree). */
  obfRoot: string;
  /** Injected for tests; defaults to fs read. */
  readSource?: (absPath: string) => string;
}

function entityFile(entity: ArchEntity): string {
  return entity.sourceLocation?.file ?? '(unknown file)';
}

function declarationLine(entity: ArchEntity): string {
  return `${entity.type} ${entity.name}`;
}

function structuralSection(
  entity: ArchEntity,
  ctx: ProbeContext,
  opts: { includePrivate: boolean; includeCalls: boolean }
): string {
  const lines: string[] = [`anchor: ${entity.name}`, declarationLine(entity)];
  const members = entity.members ?? [];
  const publicMembers = members.filter(isPublicMember);
  lines.push('members:');
  if (publicMembers.length === 0) lines.push('  (none)');
  for (const m of publicMembers) lines.push(`  ${formatMember(m)}`);
  if (opts.includePrivate) {
    const privateMembers = members.filter((m) => !isPublicMember(m));
    lines.push('private members:');
    if (privateMembers.length === 0) lines.push('  (none)');
    for (const m of privateMembers) lines.push(`  ${formatMember(m)}`);
  }
  const relations = ctx.arch.relations.filter((r) => relationInvolves(entity, r));
  lines.push('relations:');
  if (relations.length === 0) lines.push('  (none)');
  for (const r of relations) lines.push(`  ${r.source} -[${r.type}]-> ${r.target}`);
  if (opts.includeCalls) {
    const calls = (ctx.arch.callGraph?.edges ?? []).filter((e) => callEdgeInvolves(entity, e));
    lines.push('call edges:');
    if (calls.length === 0) lines.push('  (none)');
    for (const e of calls) lines.push(`  ${formatCallEdge(e)}`);
  }
  return lines.join('\n');
}

export function serializeProbe(level: Level, entity: ArchEntity, ctx: ProbeContext): string {
  switch (level) {
    case 'L0':
      return `anchor: ${entity.name}\nfile: ${entityFile(entity)}`;
    case 'L1': {
      const pkg = packageOfFile(entityFile(entity));
      const edges = ctx.packageEdges.filter((e) => e.from === pkg || e.to === pkg);
      const lines = [`anchor: ${entity.name}`, `package: ${pkg}`, 'package edges:'];
      if (edges.length === 0) lines.push('  (none)');
      for (const e of edges) {
        lines.push(`  ${e.from} -> ${e.to}${e.label !== undefined ? ` (${e.label})` : ''}`);
      }
      return lines.join('\n');
    }
    case 'L2':
      return structuralSection(entity, ctx, { includePrivate: false, includeCalls: false });
    case 'L3':
      return structuralSection(entity, ctx, { includePrivate: true, includeCalls: true });
    case 'L4': {
      const relations = ctx.arch.relations.filter((r) => relationInvolves(entity, r));
      const callGraph = (ctx.arch.callGraph?.edges ?? []).filter((e) =>
        callEdgeInvolves(entity, e)
      );
      return JSON.stringify({ anchor: entity.name, entity, relations, callGraph }, null, 1);
    }
    case 'L5': {
      const file = entityFile(entity);
      const read = ctx.readSource ?? ((p: string): string => readFileSync(p, 'utf8'));
      const source = read(path.join(ctx.obfRoot, file));
      const loc = entity.sourceLocation;
      let snippet = source;
      if (loc?.startLine !== undefined && loc.endLine !== undefined) {
        snippet = source
          .split('\n')
          .slice(loc.startLine - 1, loc.endLine)
          .join('\n');
      }
      return `anchor: ${entity.name}\nfile: ${file}\n${snippet}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Probe set assembly
// ---------------------------------------------------------------------------

export function buildProbes(ctx: ProbeContext): { records: ProbeRecord[]; meta: ProbeMeta } {
  const records: ProbeRecord[] = [];
  for (const entity of ctx.arch.entities) {
    for (const level of LEVELS) {
      records.push({
        anchor: entity.name,
        entityId: entity.id,
        level,
        text: serializeProbe(level, entity, ctx),
      });
    }
  }
  const perLevel = {} as ProbeMeta['perLevel'];
  for (const level of LEVELS) {
    const texts = records.filter((r) => r.level === level).map((r) => r.text);
    const total = texts.reduce((sum, t) => sum + t.length, 0);
    perLevel[level] = {
      count: texts.length,
      meanChars: texts.length === 0 ? 0 : Math.round((total / texts.length) * 10) / 10,
    };
  }
  const meta: ProbeMeta = {
    schema: 'probes-meta-v1',
    K: ctx.arch.entities.length,
    levels: LEVELS,
    recordCount: records.length,
    perLevel,
    anchors: ctx.arch.entities.map((e) => e.name),
  };
  return { records, meta };
}

export function toJsonl(records: ProbeRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/* c8 ignore start -- CLI entry; logic above is unit-tested */
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
  };
  const archPath = get('--archjson', path.join(LEVELS_DIR, 'L4', 'arch.json'));
  const mmdPath = get('--package-mmd', path.join(LEVELS_DIR, 'L1', 'overview', 'package.mmd'));
  const obfRoot = get('--obf-root', path.join(path.dirname(archPath), '..', '..', '..', 'obf', 'd1'));
  const outDir = get('--out-dir', path.join(LEVELS_DIR, 'probes'));

  const arch = JSON.parse(readFileSync(archPath, 'utf8')) as ArchJsonDoc;
  const packageEdges = parsePackageMermaid(readFileSync(mmdPath, 'utf8'));
  const { records, meta } = buildProbes({ arch, packageEdges, obfRoot });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'probes.jsonl'), toJsonl(records), 'utf8');
  writeFileSync(path.join(outDir, 'probes.meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(`K=${meta.K} anchors × ${LEVELS.length} levels = ${meta.recordCount} probes`);
  for (const level of LEVELS) {
    console.log(`  ${level}: count=${meta.perLevel[level].count} meanChars=${meta.perLevel[level].meanChars}`);
  }
  console.log(`-> ${path.join(outDir, 'probes.jsonl')}`);
}
/* c8 ignore stop */
