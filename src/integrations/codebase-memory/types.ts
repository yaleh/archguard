/**
 * Codebase Memory integration layer — shared types.
 *
 * Defines the backend-aware result envelope and the normalized diagnostic
 * types used across the integration. This module has no runtime dependencies
 * on the client or resolver; both depend on it.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md (phase 1).
 *
 * @module integrations/codebase-memory/types
 */

/**
 * Identifies which query backend produced a result.
 *
 * - `archguard`: ArchGuard's own `.archguard/query` artifacts.
 * - `codebase-memory`: the external `codebase-memory-mcp` graph backend.
 * - `combined`: a merged result drawing from both backends.
 */
export type QueryBackend = 'archguard' | 'codebase-memory' | 'combined';

/**
 * Categories of normalized diagnostics emitted by the integration layer.
 *
 * These intentionally avoid leaking subprocess-specific failure detail; each
 * category maps an underlying condition to an actionable, stable code.
 */
export type DiagnosticCode =
  /** Backend binary could not be found / executed. */
  | 'binary-missing'
  /** A subprocess invocation exceeded its timeout and was killed. */
  | 'timeout'
  /** Backend produced output that could not be parsed as JSON. */
  | 'parse-error'
  /** The backend reported an error (non-zero exit / error payload). */
  | 'backend-error'
  /** No Codebase Memory project matched the requested project root. */
  | 'project-not-indexed'
  /** Multiple Codebase Memory projects matched ambiguously. */
  | 'project-ambiguous'
  /** The requested mapping is not supported by the backend. */
  | 'unsupported';

/**
 * Severity of a diagnostic.
 *
 * - `error`: the operation failed for this backend.
 * - `warning`: the operation succeeded but the caller should be aware of
 *   provenance / staleness / degraded fidelity.
 * - `info`: purely informational provenance note.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A normalized diagnostic. Carries a stable {@link DiagnosticCode}, a
 * human-readable message safe to surface to the caller, and optional
 * actionable next steps (e.g. an `index_repository` command).
 */
export interface BackendDiagnostic {
  /** Stable, machine-readable category. */
  code: DiagnosticCode;
  /** Severity of this diagnostic. */
  severity: DiagnosticSeverity;
  /** Human-readable message. Must not leak raw subprocess detail. */
  message: string;
  /** Optional concrete commands / steps the caller can run to recover. */
  nextSteps?: string[];
}

/**
 * Unified, backend-aware result envelope.
 *
 * Every backend-aware response wraps its payload in this envelope so callers
 * can distinguish provenance (`backend`), the resolved Codebase Memory
 * project, freshness, and any diagnostics — without the payload shape itself
 * having to encode that metadata.
 *
 * @typeParam T - the backend-specific payload type.
 */
export interface BackendResult<T> {
  /** Which backend produced {@link data}. */
  backend: QueryBackend;
  /** The repository root the query was issued against. */
  projectRoot: string;
  /** Resolved Codebase Memory project name, when applicable. */
  codebaseMemoryProject?: string;
  /**
   * Whether the backend explicitly reported its index as stale. Only set when
   * there is concrete evidence; absence does not imply freshness.
   */
  stale?: boolean;
  /** The backend-specific payload. */
  data: T;
  /** Normalized diagnostics, if any. */
  diagnostics?: BackendDiagnostic[];
}

/**
 * Construct a {@link BackendDiagnostic} with sensible defaults.
 *
 * @param code - stable diagnostic category.
 * @param message - caller-safe human message.
 * @param options - optional severity (defaults to `error`) and next steps.
 */
export function createDiagnostic(
  code: DiagnosticCode,
  message: string,
  options: { severity?: DiagnosticSeverity; nextSteps?: string[] } = {}
): BackendDiagnostic {
  const diagnostic: BackendDiagnostic = {
    code,
    severity: options.severity ?? 'error',
    message,
  };
  if (options.nextSteps && options.nextSteps.length > 0) {
    diagnostic.nextSteps = options.nextSteps;
  }
  return diagnostic;
}

/**
 * Build a {@link BackendResult} envelope.
 *
 * @param backend - provenance of the payload.
 * @param projectRoot - repository root the query targeted.
 * @param data - backend-specific payload.
 * @param extra - optional project name, stale flag, and diagnostics.
 */
export function createBackendResult<T>(
  backend: QueryBackend,
  projectRoot: string,
  data: T,
  extra: {
    codebaseMemoryProject?: string;
    stale?: boolean;
    diagnostics?: BackendDiagnostic[];
  } = {}
): BackendResult<T> {
  const result: BackendResult<T> = {
    backend,
    projectRoot,
    data,
  };
  if (extra.codebaseMemoryProject !== undefined) {
    result.codebaseMemoryProject = extra.codebaseMemoryProject;
  }
  if (extra.stale !== undefined) {
    result.stale = extra.stale;
  }
  if (extra.diagnostics && extra.diagnostics.length > 0) {
    result.diagnostics = extra.diagnostics;
  }
  return result;
}

/**
 * Returns true if any diagnostic in the list is an `error` severity.
 */
export function hasErrorDiagnostic(diagnostics?: BackendDiagnostic[]): boolean {
  return (diagnostics ?? []).some((d) => d.severity === 'error');
}
