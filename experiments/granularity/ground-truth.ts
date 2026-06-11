/**
 * Stage 60.3 — ground-truth tooling: query CLI wrappers, built-in graph
 * algorithms, reconcile mode and SHA-256 artifact hashing.
 *
 * Calling discipline (plan Phase 60 review note): every tree gets an
 * EXPLICIT `--work-dir` (analyze) and `--arch-dir` (query). ArchGuard's
 * `inferCliWorkDir` defaults in-repo source paths to the repo root
 * `.archguard`, so omitting these flags would pollute and mis-read the main
 * project's query data. Original and obfuscated trees use independent
 * work dirs so the Phase 64.2(b) reconciliation compares isomorphic scopes.
 *
 * ArchGuard core (`src/`) is untouched — this is experiment harness code.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { articulationPoints } from './lib/graph/articulation-points';
import { inDegreeRanking, type InDegreeEntry } from './lib/graph/in-degree';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 7 ground-truth query flags from proposal §5. */
export const QUERY_FLAGS = [
  '--deps-of',
  '--used-by',
  '--implementers-of',
  '--subclasses-of',
  '--cycles',
  '--high-coupling',
  '--file',
] as const;

export type QueryFlag = (typeof QUERY_FLAGS)[number];

export interface QuerySpec {
  flag: QueryFlag;
  /** Entity / file argument; omitted for valueless flags (--cycles, --high-coupling). */
  value?: string;
}

export interface TreeSpec {
  /** Label, e.g. `original` / `obf`. Not compared during reconciliation. */
  name: string;
  /** Source directory passed to `analyze -s`. */
  sourceDir: string;
  /** Per-tree work dir: analyze `--work-dir` AND query `--arch-dir`. */
  workDir: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Subprocess runner — injectable so tests can mock argument assembly. */
export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export interface GroundTruthGraph {
  articulationPoints?: string[];
  inDegreeRanking?: InDegreeEntry[];
}

export interface GroundTruth {
  tree: string;
  /** Keyed `flag-name[:value]`, e.g. `deps-of:C1`, `cycles`. */
  queries: Record<string, unknown>;
  graph?: GroundTruthGraph;
}

export interface ObfuscationMapping {
  /** original identifier → obfuscated identifier */
  identifiers?: Record<string, string>;
  /** original file path → obfuscated file path */
  files?: Record<string, string>;
  /** original string literal → placeholder */
  strings?: Record<string, string>;
}

export interface GroundTruthDiff {
  path: string;
  left?: unknown;
  right?: unknown;
}

// ---------------------------------------------------------------------------
// Query CLI wrappers (explicit --work-dir / --arch-dir, never repo-root)
// ---------------------------------------------------------------------------

export function buildAnalyzeArgs(cliPath: string, tree: TreeSpec): string[] {
  return [
    cliPath,
    'analyze',
    '-s',
    tree.sourceDir,
    '--work-dir',
    tree.workDir,
    '-f',
    'json',
    '--no-cache',
  ];
}

export function buildQueryArgs(cliPath: string, archDir: string, query: QuerySpec): string[] {
  const args = [cliPath, 'query', '--arch-dir', archDir, '--format', 'json', query.flag];
  if (query.value !== undefined) args.push(query.value);
  return args;
}

export function queryKey(query: QuerySpec): string {
  const name = query.flag.replace(/^--/, '');
  return query.value === undefined ? name : `${name}:${query.value}`;
}

const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });

export interface GenerateOptions {
  cliPath: string;
  exec?: ExecFn;
  /** Command used to launch the CLI (default: current node binary). */
  nodeCmd?: string;
}

/**
 * Runs `analyze` once for the tree (explicit --work-dir), then every query
 * with `--arch-dir <same work dir>`, and collects parsed results.
 */
export async function generateGroundTruth(
  tree: TreeSpec,
  queries: readonly QuerySpec[],
  options: GenerateOptions
): Promise<GroundTruth> {
  const exec = options.exec ?? defaultExec;
  const nodeCmd = options.nodeCmd ?? process.execPath;

  const analyze = await exec(nodeCmd, buildAnalyzeArgs(options.cliPath, tree));
  if (analyze.exitCode !== 0) {
    throw new Error(
      `analyze exited with code ${analyze.exitCode} for tree '${tree.name}': ${analyze.stderr}`
    );
  }

  const result: GroundTruth = { tree: tree.name, queries: {} };
  for (const query of queries) {
    const res = await exec(nodeCmd, buildQueryArgs(options.cliPath, tree.workDir, query));
    if (res.exitCode !== 0) {
      throw new Error(
        `query ${query.flag} exited with code ${res.exitCode} for tree '${tree.name}': ${res.stderr}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      parsed = res.stdout.trim();
    }
    result.queries[queryKey(query)] = parsed;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Built-in graph algorithms over ArchJSON relations (proposal §5)
// ---------------------------------------------------------------------------

interface ArchJsonLike {
  entities?: { id?: string; name?: string }[];
  relations?: { from: string; to: string; type?: string }[];
}

export function graphGroundTruthFromArchJson(arch: ArchJsonLike): GroundTruthGraph {
  const nodes = (arch.entities ?? []).map((e) => e.id ?? e.name ?? '').filter((n) => n !== '');
  const relations = arch.relations ?? [];
  return {
    articulationPoints: articulationPoints(nodes, relations),
    inDegreeRanking: inDegreeRanking(relations),
  };
}

// ---------------------------------------------------------------------------
// Reconcile mode: translate original GT via mapping.json, diff against obf GT
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeTranslator(mapping: ObfuscationMapping): (s: string) => string {
  const files = Object.entries(mapping.files ?? {}).sort((a, b) => b[0].length - a[0].length);
  const identifiers = Object.entries(mapping.identifiers ?? {}).sort(
    (a, b) => b[0].length - a[0].length
  );
  const strings = mapping.strings ?? {};

  return (s: string): string => {
    // Exact-match fast paths.
    if (mapping.files?.[s] !== undefined) return mapping.files[s]!;
    if (mapping.identifiers?.[s] !== undefined) return mapping.identifiers[s]!;
    if (strings[s] !== undefined) return strings[s]!;
    // Compound strings (qualified names, query keys): file paths first
    // (longest first, plain substring), then identifiers on word boundaries.
    let out = s;
    for (const [orig, obf] of files) out = out.split(orig).join(obf);
    for (const [orig, obf] of identifiers) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(orig)}\\b`, 'g'), obf);
    }
    return out;
  };
}

function translateValue(value: unknown, tr: (s: string) => string): unknown {
  if (typeof value === 'string') return tr(value);
  if (Array.isArray(value)) return value.map((v) => translateValue(v, tr));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[tr(k)] = translateValue(v, tr);
    return out;
  }
  return value;
}

/** Translates every identifier / file path in an original-tree GT via mapping.json. */
export function translateGroundTruth(gt: GroundTruth, mapping: ObfuscationMapping): GroundTruth {
  const tr = makeTranslator(mapping);
  return {
    tree: gt.tree, // label intentionally NOT translated (and not compared)
    queries: translateValue(gt.queries, tr) as Record<string, unknown>,
    ...(gt.graph !== undefined ? { graph: translateValue(gt.graph, tr) as GroundTruthGraph } : {}),
  };
}

/**
 * Canonical form for order-insensitive comparison: arrays are compared as
 * multisets (recursively), objects with sorted keys. Query results are sets
 * semantically — ArchGuard output order is not part of the ground truth.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => canonicalize(v))
      .sort()
      .join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Diffs two GTs entry-by-entry. Empty result = reconciliation passes. */
export function diffGroundTruth(left: GroundTruth, right: GroundTruth): GroundTruthDiff[] {
  const diffs: GroundTruthDiff[] = [];

  const compareRecord = (
    prefix: string,
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown> | undefined
  ): void => {
    const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
    for (const key of keys) {
      const inLeft = a !== undefined && key in a;
      const inRight = b !== undefined && key in b;
      if (!inLeft || !inRight || canonicalize(a![key]) !== canonicalize(b![key])) {
        diffs.push({
          path: `${prefix}.${key}`,
          left: inLeft ? a![key] : undefined,
          right: inRight ? b![key] : undefined,
        });
      }
    }
  };

  compareRecord('queries', left.queries, right.queries);
  compareRecord(
    'graph',
    left.graph as Record<string, unknown> | undefined,
    right.graph as Record<string, unknown> | undefined
  );
  return diffs;
}

/**
 * Reconcile mode: read original GT + obf GT + mapping.json, translate the
 * original entry-by-entry and diff against the obfuscated tree's GT.
 */
export async function reconcile(
  originalGtPath: string,
  obfGtPath: string,
  mappingPath: string
): Promise<GroundTruthDiff[]> {
  const original = JSON.parse(readFileSync(originalGtPath, 'utf8')) as GroundTruth;
  const obf = JSON.parse(readFileSync(obfGtPath, 'utf8')) as GroundTruth;
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as ObfuscationMapping;
  return diffGroundTruth(translateGroundTruth(original, mapping), obf);
}

// ---------------------------------------------------------------------------
// SHA-256 artifact hashing (frozen-artifact discipline, proposal §11 step 3)
// ---------------------------------------------------------------------------

export function sha256OfString(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Writes `{ <relative path>: <sha256> }`, keys sorted, for artifact freezing. */
export function writeHashManifest(
  files: readonly string[],
  manifestPath: string,
  baseDir: string
): Record<string, string> {
  const manifest: Record<string, string> = {};
  const keys = files
    .map((f) => [path.relative(baseDir, f).split(path.sep).join('/'), f] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [rel, abs] of keys) manifest[rel] = sha256OfFile(abs);
  mkdirSync(path.dirname(path.resolve(manifestPath)), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function getFlagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  void (async () => {
    if (argv.includes('--reconcile')) {
      const original = getFlagValue(argv, '--original');
      const obf = getFlagValue(argv, '--obf');
      const mapping = getFlagValue(argv, '--mapping');
      if (!original || !obf || !mapping) {
        console.error(
          'Usage: tsx ground-truth.ts --reconcile --original <gt.json> --obf <gt.json> --mapping <mapping.json>'
        );
        process.exit(2);
      }
      const diffs = await reconcile(original, obf, mapping);
      if (diffs.length === 0) {
        console.log('reconcile: PASS (0 differences)');
        process.exit(0);
      }
      console.error(`reconcile: FAIL (${diffs.length} differences)`);
      for (const d of diffs) {
        console.error(`  ${d.path}: ${JSON.stringify(d.left)} != ${JSON.stringify(d.right)}`);
      }
      process.exit(1);
    }

    if (argv.includes('--hash')) {
      const manifest = getFlagValue(argv, '--manifest');
      const base = getFlagValue(argv, '--base') ?? process.cwd();
      const files = argv.filter(
        (a, i) => !a.startsWith('--') && argv[i - 1] !== '--manifest' && argv[i - 1] !== '--base'
      );
      if (!manifest || files.length === 0) {
        console.error(
          'Usage: tsx ground-truth.ts --hash <file...> --manifest <out.json> [--base <dir>]'
        );
        process.exit(2);
      }
      writeHashManifest(files, manifest, base);
      console.log(`wrote ${manifest} (${files.length} artifacts)`);
      process.exit(0);
    }

    // Generate mode.
    const treeName = getFlagValue(argv, '--tree');
    const sourceDir = getFlagValue(argv, '--source');
    const workDir = getFlagValue(argv, '--work-dir');
    const out = getFlagValue(argv, '--out');
    if (!treeName || !sourceDir || !workDir) {
      console.error(
        'Usage: tsx ground-truth.ts --tree <name> --source <dir> --work-dir <dir> ' +
          '[--cli <dist/cli/index.js>] [--queries-file <specs.json>] [--arch-json <arch.json>] [--out <gt.json>]\n' +
          '       tsx ground-truth.ts --reconcile --original <gt.json> --obf <gt.json> --mapping <mapping.json>\n' +
          '       tsx ground-truth.ts --hash <file...> --manifest <out.json> [--base <dir>]'
      );
      process.exit(2);
    }
    const cliPath =
      getFlagValue(argv, '--cli') ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/cli/index.js');
    const queriesFile = getFlagValue(argv, '--queries-file');
    const queries: QuerySpec[] = queriesFile
      ? (JSON.parse(readFileSync(queriesFile, 'utf8')) as QuerySpec[])
      : [{ flag: '--cycles' }, { flag: '--high-coupling' }];

    const tree: TreeSpec = {
      name: treeName,
      sourceDir: path.resolve(sourceDir),
      workDir: path.resolve(workDir),
    };
    const gt = await generateGroundTruth(tree, queries, { cliPath });

    const archJsonPath = getFlagValue(argv, '--arch-json');
    if (archJsonPath) {
      const arch = JSON.parse(readFileSync(archJsonPath, 'utf8')) as ArchJsonLike;
      gt.graph = graphGroundTruthFromArchJson(arch);
    }

    const json = `${JSON.stringify(gt, null, 2)}\n`;
    if (out) {
      mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      writeFileSync(out, json);
      console.log(`wrote ${out} (sha256=${sha256OfString(json)})`);
    } else {
      console.log(json);
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
