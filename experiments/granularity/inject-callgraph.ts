/**
 * Stage 61.1 — call-edge injection into L3 (Mermaid) and L4 (ArchJSON).
 *
 * Consumes the `callgraph.ts` output format (CallGraphOutput JSON) and:
 *   - appends a syntactically valid `flowchart LR` appendix at the end of an
 *     L3 method-level Mermaid file (between explicit BEGIN/END markers);
 *   - injects a `callGraph` field into an L4 ArchJSON document.
 *
 * Both operations are IDEMPOTENT: re-injecting (same or different call graph)
 * replaces the previous appendix / field instead of duplicating it.
 *
 * After injection L3 and L4 are information-equivalent (proposal §4).
 * No assumption is made about name shapes inside the call graph (Phase 65
 * re-runs callgraph.ts against obf/; this injector only consumes the JSON).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CallEdge, CallGraphOutput } from './callgraph';

export const APPENDIX_BEGIN = '%% ARCHGUARD-CALLGRAPH-APPENDIX v1 BEGIN';
export const APPENDIX_END = '%% ARCHGUARD-CALLGRAPH-APPENDIX v1 END';

/** Minimal shape the injector needs; callgraph.ts output satisfies it. */
export interface CallGraphLike {
  criteria?: string;
  stats?: CallGraphOutput['stats'];
  edges: CallEdge[];
}

/** Escape a qualified name for use inside a quoted Mermaid node label. */
export function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/</g, '(').replace(/>/g, ')');
}

/**
 * Build a standalone, syntactically valid `flowchart LR` from call edges.
 * Deterministic: node ids are assigned in first-appearance order over the
 * input edge sequence; one edge line per input edge (count preserved).
 */
export function buildFlowchartAppendix(cg: CallGraphLike): string {
  const nodeIds = new Map<string, string>();
  const nodeLines: string[] = [];
  const idOf = (qualified: string): string => {
    let id = nodeIds.get(qualified);
    if (id === undefined) {
      id = `cg${nodeIds.size}`;
      nodeIds.set(qualified, id);
      nodeLines.push(`  ${id}["${escapeLabel(qualified)}"]`);
    }
    return id;
  };
  const edgeLines: string[] = [];
  for (const edge of cg.edges) {
    const from = idOf(edge.source);
    const to = idOf(edge.target);
    const label = edge.viaInterface ? `${edge.kind} viaInterface` : edge.kind;
    edgeLines.push(`  ${from} -->|${label}| ${to}`);
  }
  return ['flowchart LR', ...nodeLines, ...edgeLines].join('\n');
}

/** Remove a previously injected appendix block (no-op when absent). */
export function stripAppendix(text: string): string {
  const begin = text.indexOf(APPENDIX_BEGIN);
  if (begin < 0) return text;
  const end = text.indexOf(APPENDIX_END, begin);
  const after = end < 0 ? text.length : end + APPENDIX_END.length;
  return (text.slice(0, begin) + text.slice(after)).replace(/\s+$/, '');
}

/** Append (or replace) the call-graph appendix at the end of a Mermaid file. */
export function injectMermaid(text: string, cg: CallGraphLike): string {
  const base = stripAppendix(text).replace(/\s+$/, '');
  return `${base}\n\n${APPENDIX_BEGIN}\n${buildFlowchartAppendix(cg)}\n${APPENDIX_END}\n`;
}

/**
 * Inject (or replace) the `callGraph` field of an ArchJSON document.
 * Returns a new object; the input is not mutated.
 */
export function injectArchJson<T extends Record<string, unknown>>(
  arch: T,
  cg: CallGraphLike
): T & { callGraph: { criteria?: string; stats?: CallGraphOutput['stats']; edges: CallEdge[] } } {
  return {
    ...arch,
    callGraph: {
      ...(cg.criteria !== undefined ? { criteria: cg.criteria } : {}),
      ...(cg.stats !== undefined ? { stats: cg.stats } : {}),
      edges: cg.edges,
    },
  };
}

/** Count of edges that will be injected (reported by the CLI). */
export function edgeCount(cg: CallGraphLike): number {
  return cg.edges.length;
}

/* c8 ignore start -- CLI entry; logic above is unit-tested */
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const multi = (flag: string): string[] => {
    const out: string[] = [];
    let i = args.indexOf(flag);
    if (i < 0) return out;
    for (i += 1; i < args.length && !args[i]!.startsWith('--'); i += 1) out.push(args[i]!);
    return out;
  };
  const cgPath = multi('--callgraph')[0];
  if (cgPath === undefined) {
    console.error(
      'usage: tsx inject-callgraph.ts --callgraph <cg.json> [--mermaid <f.mmd>...] [--archjson <f.json>...]'
    );
    process.exit(1);
  }
  const cg = JSON.parse(readFileSync(cgPath, 'utf8')) as CallGraphLike;
  for (const file of multi('--mermaid')) {
    writeFileSync(file, injectMermaid(readFileSync(file, 'utf8'), cg), 'utf8');
    console.log(`injected ${edgeCount(cg)} call edges (mermaid appendix) -> ${file}`);
  }
  for (const file of multi('--archjson')) {
    const arch = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify(injectArchJson(arch, cg), null, 2)}\n`, 'utf8');
    console.log(`injected ${edgeCount(cg)} call edges (callGraph field) -> ${file}`);
  }
}
/* c8 ignore stop */
