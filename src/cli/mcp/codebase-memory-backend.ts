/**
 * MCP ↔ Codebase Memory backend bridge.
 *
 * Centralizes the optional `backend` routing shared by the query-style MCP
 * tools (`archguard_find_entity`, `archguard_get_file_entities`,
 * `archguard_summary`, `archguard_find_callers`). The tools depend only on this
 * module and on {@link CodebaseMemoryAdapter}; they never construct the
 * subprocess client directly nor embed `codebase-memory-mcp` invocation detail.
 *
 * Design contract:
 *
 *   - When `backend` is unset or `"archguard"`, the caller keeps its existing
 *     ArchGuard code path byte-for-byte — this module is not involved.
 *   - When `backend` is `"codebase-memory"`, the caller delegates to one of the
 *     {@link runBackendQuery}-style helpers, which always resolve to a
 *     {@link BackendResult} envelope. Any adapter / subprocess failure is
 *     caught and normalized into a diagnostic envelope so the MCP server can
 *     never crash on a backend error.
 *
 * The adapter factory is injectable via {@link setBackendAdapterFactory} so unit
 * tests can supply a deterministic mock without spawning a real process or
 * depending on the external binary.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md.
 *
 * @module cli/mcp/codebase-memory-backend
 */

import { CodebaseMemoryAdapter } from '@/integrations/codebase-memory/adapter.js';
import { CodebaseMemoryClient } from '@/integrations/codebase-memory/client.js';
import {
  createBackendResult,
  createDiagnostic,
  type BackendResult,
} from '@/integrations/codebase-memory/types.js';

/** Backend selector accepted by query-style MCP tools. */
export type McpQueryBackend = 'archguard' | 'codebase-memory';

/** Inputs needed to build a {@link CodebaseMemoryAdapter} for a tool call. */
export interface BackendAdapterContext {
  /** Resolved repository root the query targets. */
  projectRoot: string;
  /** Explicit Codebase Memory project name, when the caller supplied one. */
  codebaseMemoryProject?: string;
}

/**
 * Factory that builds a {@link CodebaseMemoryAdapter} for a tool call. The
 * default implementation wires a real {@link CodebaseMemoryClient}; tests can
 * override it via {@link setBackendAdapterFactory}.
 */
export type BackendAdapterFactory = (context: BackendAdapterContext) => CodebaseMemoryAdapter;

const defaultFactory: BackendAdapterFactory = (context) => {
  const client = new CodebaseMemoryClient();
  return new CodebaseMemoryAdapter(client, {
    projectRoot: context.projectRoot,
    ...(context.codebaseMemoryProject !== undefined
      ? { project: context.codebaseMemoryProject }
      : {}),
  });
};

let adapterFactory: BackendAdapterFactory = defaultFactory;

/** Override the adapter factory (primarily for tests). */
export function setBackendAdapterFactory(factory: BackendAdapterFactory): void {
  adapterFactory = factory;
}

/** Restore the default (real subprocess-backed) adapter factory. */
export function resetBackendAdapterFactory(): void {
  adapterFactory = defaultFactory;
}

/** Build an adapter for the given context using the active factory. */
export function createBackendAdapter(context: BackendAdapterContext): CodebaseMemoryAdapter {
  return adapterFactory(context);
}

/**
 * Run a Codebase Memory query through the adapter, normalizing any thrown
 * error into a diagnostic envelope. The query function receives a freshly
 * built adapter and must return a {@link BackendResult}.
 *
 * @typeParam T - the backend-specific payload type.
 * @param context - project root + optional explicit project.
 * @param query - maps the adapter to a backend query promise.
 */
export async function runBackendQuery<T>(
  context: BackendAdapterContext,
  query: (adapter: CodebaseMemoryAdapter) => Promise<BackendResult<T>>,
  emptyData: T
): Promise<BackendResult<T>> {
  try {
    const adapter = createBackendAdapter(context);
    return await query(adapter);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createBackendResult('codebase-memory', context.projectRoot, emptyData, {
      ...(context.codebaseMemoryProject !== undefined
        ? { codebaseMemoryProject: context.codebaseMemoryProject }
        : {}),
      diagnostics: [
        createDiagnostic('backend-error', `Codebase Memory backend query failed: ${message}`),
      ],
    });
  }
}
