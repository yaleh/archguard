import type { DiagramConfig } from './config-diagram.js';
import type { ProjectSemantics } from './extensions/project-semantics.js';
import type { MermaidConfig, OutputFormat } from './config-mermaid.js';
import type { FitnessConfig } from '../analysis/fitness/rule-types.js';

/**
 * Query backend identifier.
 *
 * - `archguard`: read `.archguard/query` artifacts via QueryEngine (default).
 * - `codebase-memory`: delegate to the optional `codebase-memory-mcp` backend.
 * - `auto`: prefer archguard; fall back to codebase-memory when applicable.
 */
export type QueryBackendKind = 'archguard' | 'codebase-memory' | 'auto';

/**
 * Optional configuration for the Codebase Memory query backend adapter.
 * All fields carry defaults; provide an empty object to accept all defaults.
 */
export interface CodebaseMemoryConfig {
  /** External CLI command to invoke (default: `codebase-memory-mcp`). */
  command: string;
  /** Project resolution strategy or explicit project name (default: `auto`). */
  project: string;
  /** Whether the adapter may index the repo automatically (default: false). */
  autoIndex: boolean;
  /** Subprocess timeout in milliseconds (default: 10000). */
  timeoutMs: number;
  /** Maximum number of results to request from the backend (default: 20). */
  maxResults: number;
}

/**
 * Optional query backend selection (proposal: codebase-memory-backend-adapter).
 *
 * Omitting this is equivalent to `{ primary: 'archguard' }`, preserving
 * existing behavior. Explicit CLI/MCP arguments take precedence over this
 * config, which in turn takes precedence over defaults.
 */
export interface QueryBackendsConfig {
  /** Primary query backend (default: `archguard`). */
  primary: QueryBackendKind;
  /** Optional fallback backend used when the primary cannot answer. */
  fallback?: QueryBackendKind;
  /** Codebase Memory adapter settings (defaults filled when present). */
  codebaseMemory?: CodebaseMemoryConfig;
}

export interface GlobalConfig {
  workDir?: string;
  outputDir: string;
  format: OutputFormat;
  mermaid?: MermaidConfig;
  exclude: string[];
  cli: {
    command: string;
    args: string[];
    timeout: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    dir?: string;
  };
  concurrency: number;
  verbose: boolean;
  maxNodesPerDiagram?: number;
  projectSemantics?: Partial<ProjectSemantics>;
  fitness?: FitnessConfig;
  /** Optional query backend selection (default: primary archguard). */
  queryBackends?: QueryBackendsConfig;
}

export interface ArchGuardConfig extends GlobalConfig {
  diagrams: DiagramConfig[];
}
