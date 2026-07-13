/**
 * Query backend wiring for the CLI `query` command (TASK-22.4).
 *
 * This module is the ONLY bridge between the CLI query command and the
 * Codebase Memory integration layer. The command depends on the
 * {@link CodebaseMemoryAdapter} exclusively through {@link createCodebaseMemoryAdapter};
 * it never spawns the `codebase-memory-mcp` subprocess itself.
 *
 * Responsibilities:
 *   - Build a {@link CodebaseMemoryAdapter} from optional `queryBackends` config
 *     plus per-invocation CLI flags (`--cbm-project`, `--arch-dir`).
 *   - Derive the repository root used for project resolution from the
 *     `.archguard` work directory.
 *   - Render adapter {@link BackendResult} envelopes for CLI text output,
 *     including the provenance footer (backend + project + diagnostics).
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md.
 *
 * @module cli/query/query-backend
 */

import path from 'node:path';
import { CodebaseMemoryClient } from '@/integrations/codebase-memory/client.js';
import { CodebaseMemoryAdapter } from '@/integrations/codebase-memory/adapter.js';
import type { BackendResult, BackendDiagnostic } from '@/integrations/codebase-memory/types.js';
import type {
  EntityHit,
  CallerEdge,
  FindEntityData,
  FileEntitiesData,
  FindCallersData,
} from '@/integrations/codebase-memory/adapter.js';
import type { CodebaseMemoryConfig } from '@/types/config-global.js';

/** Options for {@link createCodebaseMemoryAdapter}. */
export interface CreateAdapterOptions {
  /** Repository root the queries target (project resolution / provenance). */
  projectRoot: string;
  /**
   * Explicit Codebase Memory project name. Takes precedence over config; when
   * resolved to `auto` (or undefined) the adapter resolves via `list_projects`.
   */
  project?: string;
  /** Optional `queryBackends.codebaseMemory` config block. */
  config?: CodebaseMemoryConfig;
}

/**
 * Build a {@link CodebaseMemoryAdapter} from config + CLI flags.
 *
 * Project precedence: explicit `--cbm-project` > config `project` (unless the
 * sentinel `auto`) > automatic resolution via `list_projects`.
 */
export function createCodebaseMemoryAdapter(options: CreateAdapterOptions): CodebaseMemoryAdapter {
  const config = options.config;
  const client = new CodebaseMemoryClient({
    ...(config?.command !== undefined ? { command: config.command } : {}),
    ...(config?.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  });

  const explicitProject =
    options.project ?? (config?.project && config.project !== 'auto' ? config.project : undefined);

  return new CodebaseMemoryAdapter(client, {
    projectRoot: options.projectRoot,
    ...(explicitProject !== undefined ? { project: explicitProject } : {}),
  });
}

/**
 * Derive the repository root from a resolved `.archguard` work directory.
 *
 * When `archDir` is a `.archguard` directory, the project root is its parent;
 * otherwise the directory itself is treated as the root.
 */
export function resolveProjectRoot(archDir: string): string {
  return path.basename(archDir) === '.archguard' ? path.dirname(archDir) : archDir;
}

// -- Text formatters -------------------------------------------------------

/** Format a list of Codebase Memory entity hits for CLI text output. */
export function formatEntityHits(hits: EntityHit[], title: string): void {
  console.log(`${title}:\n`);
  if (hits.length === 0) {
    console.log('  (none)');
    console.log(`\n  Total: 0`);
    return;
  }
  for (const h of hits) {
    const name = h.qualifiedName ?? h.name ?? '(unknown)';
    const kind = h.kind ? ` (${h.kind})` : '';
    const loc = h.file ? ` @ ${h.file}${h.line !== undefined ? `:${h.line}` : ''}` : '';
    console.log(`  ${name}${kind}${loc}`);
  }
  console.log(`\n  Total: ${hits.length}`);
}

/** Format a list of Codebase Memory caller edges for CLI text output. */
export function formatCallerEdges(edges: CallerEdge[], title: string): void {
  console.log(`${title}:`);
  if (edges.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const e of edges) {
    const from = e.from ?? '(unknown)';
    const loc = e.file ? `  ${e.file}${e.line !== undefined ? `:${e.line}` : ''}` : '';
    console.log(`  ${from} -> ${e.to ?? '(target)'}${loc}`);
  }
}

/** Format disambiguation candidates (when a caller trace was ambiguous). */
export function formatCandidates(candidates: EntityHit[]): void {
  if (candidates.length === 0) return;
  console.log('\n  Candidates (retry with a qualified name):');
  for (const c of candidates) {
    const name = c.qualifiedName ?? c.name ?? '(unknown)';
    console.log(`    ${name}`);
  }
}

/**
 * Print the provenance footer for a backend result: backend name, resolved
 * project, and any normalized diagnostics with their next-steps.
 */
export function printProvenanceFooter(result: BackendResult<unknown>): void {
  const project = result.codebaseMemoryProject ? ` (project: ${result.codebaseMemoryProject})` : '';
  console.log(`\nBackend: ${result.backend}${project}`);
  if (result.projectRoot) {
    console.log(`Project root: ${result.projectRoot}`);
  }
  if (result.stale) {
    console.log('Note: the backend reported its index as stale.');
  }
  printDiagnostics(result.diagnostics);
}

/** Print diagnostic messages and their next steps below a result. */
function printDiagnostics(diagnostics?: BackendDiagnostic[]): void {
  for (const d of diagnostics ?? []) {
    console.log(`Note [${d.code}]: ${d.message}`);
    for (const step of d.nextSteps ?? []) {
      console.log(`  -> ${step}`);
    }
  }
}

/** Re-export the payload types the command renders, for convenience. */
export type { FindEntityData, FileEntitiesData, FindCallersData };
