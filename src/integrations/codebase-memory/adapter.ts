/**
 * Codebase Memory integration layer — query-intent adapter.
 *
 * Maps ArchGuard query intents onto Codebase Memory tool calls, isolating the
 * external backend's shape behind a stable surface. CLI / MCP entry points
 * depend only on this adapter, never on the subprocess client or the raw
 * Codebase Memory schema.
 *
 * Mapping (see proposal phases 2–5):
 *
 *   - {@link CodebaseMemoryAdapter.findEntity}      -> `search_graph(name_pattern)`
 *   - {@link CodebaseMemoryAdapter.getFileEntities} -> `search_graph(file_pattern)`
 *   - {@link CodebaseMemoryAdapter.findCallers}     -> `trace_path(direction:inbound)`
 *       with a `search_graph` candidate-disambiguation fallback on failure.
 *   - {@link CodebaseMemoryAdapter.getCodeSnippet}  -> `get_code_snippet` (enrichment)
 *   - {@link CodebaseMemoryAdapter.getArchitecture} -> `get_architecture` (enrichment)
 *
 * Design rules honored here:
 *
 *   - Every public method returns a {@link BackendResult} envelope carrying
 *     provenance (`backend`, `codebaseMemoryProject`) and `diagnostics`.
 *   - Codebase Memory nodes are never disguised as ArchGuard `Entity` objects;
 *     fields that cannot map losslessly are preserved under `raw`.
 *   - Result sizes are bounded with explicit limits / truncation so MCP
 *     responses cannot blow up the caller's context.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md.
 *
 * @module integrations/codebase-memory/adapter
 */

import type { CodebaseMemoryClient } from '@/integrations/codebase-memory/client.js';
import { resolveProject } from '@/integrations/codebase-memory/project-resolver.js';
import {
  createBackendResult,
  type BackendDiagnostic,
  type BackendResult,
} from '@/integrations/codebase-memory/types.js';

/** Default cap on `search_graph` results when searching by symbol name. */
const DEFAULT_ENTITY_LIMIT = 20;
/** Default cap on `search_graph` results when listing a file's entities. */
const DEFAULT_FILE_LIMIT = 100;
/** Default cap on `trace_path` caller edges returned. */
const DEFAULT_CALLERS_LIMIT = 20;
/** Default cap on candidate symbols offered for disambiguation. */
const DEFAULT_CANDIDATES_LIMIT = 20;
/** Default cap on returned snippet characters. */
const DEFAULT_MAX_SNIPPET_CHARS = 4_000;

/**
 * A single entity hit, normalized from a Codebase Memory `search_graph` node.
 *
 * The mapped fields are best-effort and may be `undefined`; the full original
 * node is always retained under {@link EntityHit.raw} so nothing is lost.
 */
export interface EntityHit {
  /** Short symbol name, if present. */
  name?: string;
  /** Fully qualified name, if present. */
  qualifiedName?: string;
  /** Node kind (e.g. `Class`, `Function`), as reported by the backend. */
  kind?: string;
  /** Source file path, if present. */
  file?: string;
  /** 1-based line number, if present. */
  line?: number;
  /** The original, unmapped backend node. */
  raw: Record<string, unknown>;
}

/** Payload for {@link CodebaseMemoryAdapter.findEntity}. */
export interface FindEntityData {
  /** Matched entities, capped at the effective limit. */
  results: EntityHit[];
}

/** Payload for {@link CodebaseMemoryAdapter.getFileEntities}. */
export interface FileEntitiesData {
  /** The file pattern that was queried. */
  file: string;
  /** Entities found in the file, capped at the effective limit. */
  results: EntityHit[];
}

/** A single caller edge, normalized from a Codebase Memory `trace_path` path. */
export interface CallerEdge {
  /** Calling symbol. */
  from?: string;
  /** Called symbol (the trace target). */
  to?: string;
  /** Source file of the call site, if present. */
  file?: string;
  /** Line of the call site, if present. */
  line?: number;
  /** The original, unmapped backend path entry. */
  raw: Record<string, unknown>;
}

/** Payload for {@link CodebaseMemoryAdapter.findCallers}. */
export interface FindCallersData {
  /** Caller edges, capped at the effective limit. Empty on trace failure. */
  callers: CallerEdge[];
  /**
   * Candidate symbols for disambiguation, populated only when the direct
   * `trace_path` failed and a `search_graph` fallback yielded options.
   */
  candidates?: EntityHit[];
}

/** Payload for {@link CodebaseMemoryAdapter.getCodeSnippet}. */
export interface CodeSnippetData {
  /** Qualified name that was requested. */
  qualifiedName: string;
  /** Source file, if reported by the backend. */
  file?: string;
  /** The (possibly truncated) snippet text. Empty on failure. */
  snippet: string;
  /** True if {@link CodeSnippetData.snippet} was truncated for size. */
  truncated?: boolean;
  /** The original, unmapped backend payload. */
  raw?: Record<string, unknown>;
}

/** Payload for {@link CodebaseMemoryAdapter.getArchitecture}. */
export interface ArchitectureData {
  /**
   * The raw `get_architecture` payload, preserved verbatim. ArchGuard's own
   * summary remains the authoritative source; this is enrichment only and is
   * deliberately not coerced into an ArchGuard shape.
   */
  raw?: Record<string, unknown>;
}

/** Options accepted by {@link CodebaseMemoryAdapter}. */
export interface CodebaseMemoryAdapterOptions {
  /** Repository root the queries target; recorded in the result envelope. */
  projectRoot: string;
  /**
   * Explicit Codebase Memory project name. When provided, project resolution
   * via `list_projects` is skipped entirely.
   */
  project?: string;
}

/** Per-call options for entity / file searches. */
export interface SearchOptions {
  /** Override the result limit. */
  limit?: number;
}

/** Per-call options for {@link CodebaseMemoryAdapter.findCallers}. */
export interface FindCallersOptions {
  /** Override the caller-edge limit. */
  limit?: number;
  /** Trace depth passed to `trace_path`. */
  depth?: number;
}

/** Per-call options for {@link CodebaseMemoryAdapter.getCodeSnippet}. */
export interface CodeSnippetOptions {
  /** Whether to request neighbor context. Default: true. */
  includeNeighbors?: boolean;
  /** Maximum snippet characters to retain. */
  maxSnippetChars?: number;
}

/** Escape regex metacharacters so a literal name becomes a safe pattern. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coerce an unknown value to a string, or undefined. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Coerce an unknown value to a number, or undefined. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Normalize one `search_graph` node into an {@link EntityHit}. */
function toEntityHit(node: Record<string, unknown>): EntityHit {
  const hit: EntityHit = { raw: node };
  const name = asString(node.name);
  const qualified = asString(node.qualified_name) ?? asString(node.qualifiedName);
  const kind = asString(node.kind);
  const file = asString(node.file);
  const line = asNumber(node.line);
  if (name !== undefined) hit.name = name;
  if (qualified !== undefined) hit.qualifiedName = qualified;
  if (kind !== undefined) hit.kind = kind;
  if (file !== undefined) hit.file = file;
  if (line !== undefined) hit.line = line;
  return hit;
}

/** Normalize one `trace_path` path entry into a {@link CallerEdge}. */
function toCallerEdge(entry: Record<string, unknown>): CallerEdge {
  const edge: CallerEdge = { raw: entry };
  const from = asString(entry.from);
  const to = asString(entry.to);
  const file = asString(entry.file);
  const line = asNumber(entry.line);
  if (from !== undefined) edge.from = from;
  if (to !== undefined) edge.to = to;
  if (file !== undefined) edge.file = file;
  if (line !== undefined) edge.line = line;
  return edge;
}

/** Pull the `results` array out of a `search_graph` payload, defensively. */
function extractResults(data: unknown): Record<string, unknown>[] {
  const results = (data as { results?: unknown })?.results;
  return Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
}

/** Pull the `paths` array out of a `trace_path` payload, defensively. */
function extractPaths(data: unknown): Record<string, unknown>[] {
  const paths = (data as { paths?: unknown })?.paths;
  return Array.isArray(paths) ? (paths as Record<string, unknown>[]) : [];
}

/**
 * Maps ArchGuard query intents to Codebase Memory tool calls.
 *
 * Construct with a {@link CodebaseMemoryClient} (real or mocked) and a target
 * `projectRoot`. Each call resolves the Codebase Memory project (unless one was
 * supplied explicitly), issues the mapped tool call, normalizes the payload,
 * and returns a {@link BackendResult} envelope.
 */
export class CodebaseMemoryAdapter {
  private readonly client: CodebaseMemoryClient;
  private readonly projectRoot: string;
  private readonly explicitProject?: string;

  constructor(client: CodebaseMemoryClient, options: CodebaseMemoryAdapterOptions) {
    this.client = client;
    this.projectRoot = options.projectRoot;
    this.explicitProject = options.project;
  }

  /**
   * `findEntity(name)` -> `search_graph({ name_pattern: ".*name.*" })`.
   *
   * The literal name is regex-escaped and wrapped so the backend performs a
   * fuzzy contains-match. Results are normalized and capped.
   */
  async findEntity(
    name: string,
    options: SearchOptions = {}
  ): Promise<BackendResult<FindEntityData>> {
    const limit = options.limit ?? DEFAULT_ENTITY_LIMIT;
    const resolved = await this.resolveProjectOrDiagnostic();
    if (resolved.project === undefined) {
      return this.envelope({ results: [] }, undefined, [resolved.diagnostic]);
    }

    const namePattern = `.*${escapeRegex(name)}.*`;
    const call = await this.client.call('search_graph', {
      project: resolved.project,
      name_pattern: namePattern,
      limit,
    });
    if (call.ok !== true) {
      return this.envelope({ results: [] }, resolved.project, [call.diagnostic]);
    }

    const results = extractResults(call.data).slice(0, limit).map(toEntityHit);
    return this.envelope({ results }, resolved.project);
  }

  /**
   * `getFileEntities(file)` -> `search_graph({ file_pattern: file })`.
   *
   * Uses a higher default limit than {@link findEntity} because a single file
   * may legitimately contain many nodes.
   */
  async getFileEntities(
    file: string,
    options: SearchOptions = {}
  ): Promise<BackendResult<FileEntitiesData>> {
    const limit = options.limit ?? DEFAULT_FILE_LIMIT;
    const resolved = await this.resolveProjectOrDiagnostic();
    if (resolved.project === undefined) {
      return this.envelope({ file, results: [] }, undefined, [resolved.diagnostic]);
    }

    const call = await this.client.call('search_graph', {
      project: resolved.project,
      file_pattern: file,
      limit,
    });
    if (call.ok !== true) {
      return this.envelope({ file, results: [] }, resolved.project, [call.diagnostic]);
    }

    const results = extractResults(call.data).slice(0, limit).map(toEntityHit);
    return this.envelope({ file, results }, resolved.project);
  }

  /**
   * `findCallers(name)` -> `trace_path({ direction: "inbound" })`.
   *
   * `trace_path` requires a precise (qualified) name. When it fails, the
   * adapter falls back to `search_graph` and returns the matches as
   * `candidates` so the caller can disambiguate and retry with a qualified
   * name — the original trace diagnostic is preserved in the envelope.
   */
  async findCallers(
    name: string,
    options: FindCallersOptions = {}
  ): Promise<BackendResult<FindCallersData>> {
    const limit = options.limit ?? DEFAULT_CALLERS_LIMIT;
    const resolved = await this.resolveProjectOrDiagnostic();
    if (resolved.project === undefined) {
      return this.envelope({ callers: [] }, undefined, [resolved.diagnostic]);
    }

    const traceArgs: Record<string, unknown> = {
      project: resolved.project,
      function_name: name,
      direction: 'inbound',
      mode: 'calls',
    };
    if (options.depth !== undefined) {
      traceArgs.depth = options.depth;
    }

    const trace = await this.client.call('trace_path', traceArgs);
    if (trace.ok === true) {
      const callers = extractPaths(trace.data).slice(0, limit).map(toCallerEdge);
      return this.envelope({ callers }, resolved.project);
    }

    // trace failed -> disambiguation fallback via search_graph candidates.
    const candidates = await this.candidatesFor(name, resolved.project);
    return this.envelope({ callers: [], candidates }, resolved.project, [trace.diagnostic]);
  }

  /**
   * `getCodeSnippet(qualifiedName)` -> `get_code_snippet`.
   *
   * Enrichment only. The snippet is truncated to bound the response so large
   * source bodies never flood the caller's context.
   */
  async getCodeSnippet(
    qualifiedName: string,
    options: CodeSnippetOptions = {}
  ): Promise<BackendResult<CodeSnippetData>> {
    const maxChars = options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS;
    const includeNeighbors = options.includeNeighbors ?? true;
    const resolved = await this.resolveProjectOrDiagnostic();
    if (resolved.project === undefined) {
      return this.envelope({ qualifiedName, snippet: '' }, undefined, [resolved.diagnostic]);
    }

    const call = await this.client.call('get_code_snippet', {
      project: resolved.project,
      qualified_name: qualifiedName,
      include_neighbors: includeNeighbors,
    });
    if (call.ok !== true) {
      return this.envelope({ qualifiedName, snippet: '' }, resolved.project, [call.diagnostic]);
    }

    const raw = (call.data ?? {}) as Record<string, unknown>;
    const rawSnippet = asString(raw.snippet) ?? '';
    const file = asString(raw.file);
    const { text, truncated } = truncate(rawSnippet, maxChars);

    const data: CodeSnippetData = { qualifiedName, snippet: text, raw };
    if (file !== undefined) data.file = file;
    if (truncated) data.truncated = true;
    return this.envelope(data, resolved.project);
  }

  /**
   * `getArchitecture()` -> `get_architecture`.
   *
   * Enrichment only. The raw payload is preserved verbatim; ArchGuard's own
   * summary remains authoritative, so nothing is coerced into an ArchGuard
   * shape here.
   */
  async getArchitecture(): Promise<BackendResult<ArchitectureData>> {
    const resolved = await this.resolveProjectOrDiagnostic();
    if (resolved.project === undefined) {
      return this.envelope({}, undefined, [resolved.diagnostic]);
    }

    const call = await this.client.call('get_architecture', {
      project: resolved.project,
    });
    if (call.ok !== true) {
      return this.envelope({}, resolved.project, [call.diagnostic]);
    }

    const raw = (call.data ?? {}) as Record<string, unknown>;
    return this.envelope({ raw }, resolved.project);
  }

  // --- internals ----------------------------------------------------------

  /**
   * Resolve the target project: an explicit project short-circuits resolution;
   * otherwise delegate to {@link resolveProject}. Returns either a project name
   * or a normalized diagnostic (never both).
   */
  private async resolveProjectOrDiagnostic(): Promise<
    | { project: string; diagnostic?: undefined }
    | { project?: undefined; diagnostic: BackendDiagnostic }
  > {
    if (this.explicitProject !== undefined) {
      return { project: this.explicitProject };
    }
    const resolution = await resolveProject(this.client, this.projectRoot);
    if (resolution.ok === true) {
      return { project: resolution.project };
    }
    return { diagnostic: resolution.diagnostic };
  }

  /** Run a `search_graph` disambiguation query, returning capped candidates. */
  private async candidatesFor(name: string, project: string): Promise<EntityHit[]> {
    const call = await this.client.call('search_graph', {
      project,
      name_pattern: `.*${escapeRegex(name)}.*`,
      limit: DEFAULT_CANDIDATES_LIMIT,
    });
    if (call.ok !== true) {
      return [];
    }
    return extractResults(call.data).slice(0, DEFAULT_CANDIDATES_LIMIT).map(toEntityHit);
  }

  /** Build a {@link BackendResult} with this adapter's provenance fields. */
  private envelope<T>(
    data: T,
    project?: string,
    diagnostics?: BackendDiagnostic[]
  ): BackendResult<T> {
    return createBackendResult('codebase-memory', this.projectRoot, data, {
      ...(project !== undefined ? { codebaseMemoryProject: project } : {}),
      ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
    });
  }
}

/** Truncate text to `max` characters, appending an ellipsis marker. */
function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, max)}… (truncated)`, truncated: true };
}
