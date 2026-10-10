/**
 * `archguard slice-delta` — CLI adapter for Refactor Slice / Expected Delta.
 *
 * A thin I/O shell around the pure core in `src/analysis/slice-delta/`. ALL the
 * environment-touching work lives here (reading the graph, provenance, git
 * consistency); the core never reads a file or the environment.
 *
 * Exit codes (three-state):
 *   0 = evaluated and guards clean
 *   1 = evaluated but a guard was triggered
 *   2 = not evaluated (insufficient signal — never conflated with 0)
 *
 * The report NEVER carries `pass` / `fail` / `exitCode` field names: it says
 * `evaluated` / `not-evaluated` and `guards.clean`, so an exit code cannot be
 * misread as a declared-rules gate.
 */

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'module';
import { loadEngine } from '../query/engine-loader.js';
import { simulateRefactorSlice } from '@/analysis/slice-delta/index.js';
import type { RefactorSliceDeclaration, SliceDeltaReport } from '@/analysis/slice-delta/index.js';
import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';

const require = createRequire(import.meta.url);

/** ArchGuard version read from the shipped package.json (proves which build produced a report). */
export function readArchguardVersion(): string | null {
  try {
    const pkg = require('../../../package.json') as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export interface SliceDeltaCliOptions {
  slice?: string;
  root?: string;
  scope?: string;
  arch?: string;
  observed?: string;
  json?: string;
  projectRoot?: string;
}

export type SliceDeltaExitCode = 0 | 1 | 2;

export interface SliceDeltaCliResult {
  exitCode: SliceDeltaExitCode;
  report: SliceDeltaReport;
}

interface ProvenanceConsistency {
  status: 'match' | 'mismatch' | 'not-checked';
  head?: string;
  reason?: string;
}

/**
 * `match` / `mismatch` / `not-checked` — the ONLY place git is probed. A root that
 * is not a git work tree reports `not-checked` with the reason, never a guess.
 */
export function sliceDeltaProvenanceConsistency(
  gitRoot: string | null,
  declaredCommit: unknown
): ProvenanceConsistency {
  if (typeof declaredCommit !== 'string' || declaredCommit.length === 0) {
    return { status: 'not-checked', reason: 'slice.provenance.commit 未声明' };
  }
  if (!gitRoot) {
    return { status: 'not-checked', reason: '未提供 --root，且 ArchJSON 没有 workspaceRoot' };
  }
  try {
    const head = execFileSync('git', ['-C', gitRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head === declaredCommit
      ? { status: 'match', head, reason: '工作区 HEAD 与 slice.provenance.commit 一致' }
      : {
          status: 'mismatch',
          head,
          reason: `工作区 HEAD=${head} 与 slice.provenance.commit=${declaredCommit} 不一致：这份 ArchJSON 可能不是那个 commit 的树`,
        };
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    return {
      status: 'not-checked',
      reason: `--root 不是 git work tree（git rev-parse 失败）：${msg}`,
    };
  }
}

/** Build the five-section provenance段 (analysis / slice / observed / tool / provenanceConsistency). */
export function buildSliceDeltaProvenance(args: {
  analysisSource: string;
  workspaceRoot: string | null;
  timestamp: string | null;
  language: string | null;
  sliceSource: string;
  sliceProvenance?: Record<string, unknown>;
  observed: Record<string, unknown> | null;
  observedSource: string | null;
  gitRoot: string | null;
}): Record<string, unknown> {
  return {
    analysis: {
      source: args.analysisSource,
      workspaceRoot: args.workspaceRoot,
      timestamp: args.timestamp,
      language: args.language,
    },
    slice: { source: args.sliceSource, ...(args.sliceProvenance ?? {}) },
    observed: args.observed
      ? {
          source: args.observedSource,
          ...((args.observed['provenance'] as Record<string, unknown> | undefined) ?? {}),
        }
      : null,
    tool: { archguardVersion: readArchguardVersion(), command: 'archguard slice-delta' },
    provenanceConsistency: sliceDeltaProvenanceConsistency(
      args.gitRoot,
      args.sliceProvenance?.['commit']
    ),
  };
}

function notEvaluated(reason: string): SliceDeltaCliResult {
  return { exitCode: 2, report: { status: 'not-evaluated', reason } };
}

async function readJsonFile(
  file: string,
  label: string
): Promise<{ value: unknown; error?: string }> {
  try {
    return { value: await fs.readJson(file) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: undefined, error: `读取 ${label} 失败: ${msg}` };
  }
}

interface ResolvedGraph {
  moduleGraph: TsModuleGraph | undefined;
  analysisSource: string;
  workspaceRoot: string | null;
  timestamp: string | null;
  language: string | null;
}

/**
 * Resolve the module graph either from an explicit `--arch` file or from the
 * project's `.archguard/query/` artifacts via the SAME scope/manifest resolution
 * every other MCP tool uses. A scope that cannot be resolved is a hard
 * `not-evaluated` (exit 2) — it NEVER silently falls back to an empty graph.
 */
async function resolveGraph(
  opts: SliceDeltaCliOptions
): Promise<{ graph?: ResolvedGraph; error?: string }> {
  if (opts.arch) {
    const archPath = path.resolve(opts.arch);
    const read = await readJsonFile(archPath, '--arch 输入');
    if (read.error) return { error: read.error };
    const arch = read.value as {
      workspaceRoot?: string;
      timestamp?: string;
      language?: string;
      extensions?: { tsAnalysis?: { moduleGraph?: TsModuleGraph } };
    };
    return {
      graph: {
        moduleGraph: arch?.extensions?.tsAnalysis?.moduleGraph,
        analysisSource: archPath,
        workspaceRoot: arch?.workspaceRoot ?? null,
        timestamp: arch?.timestamp ?? null,
        language: arch?.language ?? null,
      },
    };
  }

  const projectRoot = path.resolve(opts.projectRoot ?? process.cwd());
  const archDir = path.join(projectRoot, '.archguard');
  try {
    const ctx = await loadEngine(archDir, opts.scope);
    const archJsonPath = path.join(archDir, 'query', ctx.scopeEntry.key, 'arch.json');
    let workspaceRoot: string | null = null;
    let timestamp: string | null = null;
    let language: string | null = null;
    try {
      const raw = (await fs.readJson(archJsonPath)) as {
        workspaceRoot?: string;
        timestamp?: string;
        language?: string;
      };
      workspaceRoot = raw.workspaceRoot ?? null;
      timestamp = raw.timestamp ?? null;
      language = raw.language ?? null;
    } catch {
      // arch.json was validated by loadEngine; a re-read failure only degrades provenance.
    }
    return {
      graph: {
        moduleGraph: ctx.extensionAccessor.getTsModuleGraph(),
        analysisSource: archJsonPath,
        workspaceRoot,
        timestamp,
        language,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: `无法从 ${archDir}/query 解析 scope（${msg}）。先运行 \`archguard analyze\`，或用 --arch <arch.json> 显式给出图。`,
    };
  }
}

/** Core adapter entry point (also used directly by tests). */
export async function runSliceDelta(opts: SliceDeltaCliOptions): Promise<SliceDeltaCliResult> {
  if (!opts.slice) {
    return notEvaluated('缺少参数：需要 --slice <slice.json>');
  }

  const sliceRead = await readJsonFile(path.resolve(opts.slice), '--slice 输入');
  if (sliceRead.error) return notEvaluated(sliceRead.error);
  const slice = sliceRead.value as RefactorSliceDeclaration;

  let observed: Record<string, unknown> | null = null;
  let observedSource: string | null = null;
  if (opts.observed) {
    observedSource = path.resolve(opts.observed);
    const observedRead = await readJsonFile(observedSource, '--observed 输入');
    if (observedRead.error) return notEvaluated(observedRead.error);
    observed = observedRead.value as Record<string, unknown>;
  }

  const resolved = await resolveGraph(opts);
  if (resolved.error || !resolved.graph) {
    return notEvaluated(resolved.error ?? '无法解析图输入');
  }
  const graph = resolved.graph;

  if (!graph.moduleGraph || !Array.isArray(graph.moduleGraph.nodes)) {
    return notEvaluated(
      `图输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）：${graph.analysisSource}`
    );
  }

  const gitRoot = opts.root ? path.resolve(opts.root) : graph.workspaceRoot;
  const provenance = buildSliceDeltaProvenance({
    analysisSource: graph.analysisSource,
    workspaceRoot: graph.workspaceRoot,
    timestamp: graph.timestamp,
    language: graph.language,
    sliceSource: path.resolve(opts.slice),
    sliceProvenance: (slice as { provenance?: Record<string, unknown> })?.provenance,
    observed,
    observedSource,
    gitRoot,
  });

  const report = simulateRefactorSlice({
    graph: graph.moduleGraph,
    slice,
    observed,
    provenance,
  });

  if (report.status === 'not-evaluated') return { exitCode: 2, report };
  return { exitCode: report.guards.clean ? 0 : 1, report };
}

/** `archguard slice-delta` command. */
export function createSliceDeltaCommand(): Command {
  return new Command('slice-delta')
    .description(
      'Simulate an explicitly-declared refactor slice and report the deterministic architecture delta. ' +
        'ArchGuard never picks the slice — the caller supplies it. Exit 0 = evaluated & guards clean, ' +
        '1 = evaluated but a guard was triggered, 2 = not evaluated.'
    )
    .requiredOption(
      '--slice <file>',
      'Explicit slice declaration (subject/proposedCut/mustNotChange/negativeControl)'
    )
    .option(
      '--arch <file>',
      'Package-level ArchJSON to read the module graph from (default: resolve from <projectRoot>/.archguard by --scope)'
    )
    .option(
      '--root <dir>',
      'Workspace root used for provenance / git consistency (default: ArchJSON.workspaceRoot)'
    )
    .option(
      '--scope <key>',
      'Query scope key / label fragment when resolving the graph from .archguard'
    )
    .option(
      '--observed <file>',
      'Optional posterior reading; only feeds the comparison section, never the computation'
    )
    .option('--json <out>', 'Also write the structured report JSON to this file')
    .option('--project-root <dir>', 'Project root containing .archguard (default: cwd)')
    .action(async (o: SliceDeltaCliOptions) => {
      const { exitCode, report } = await runSliceDelta(o);
      if (o.json) {
        await fs.writeFile(path.resolve(o.json), JSON.stringify(report, null, 2));
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(exitCode);
    });
}
