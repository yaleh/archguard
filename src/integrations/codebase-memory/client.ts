/**
 * Codebase Memory integration layer — CLI client.
 *
 * Wraps invocations of `codebase-memory-mcp cli <tool> <json>`, handling
 * timeout, stdout/stderr capture, JSON parsing, and normalization of every
 * failure mode (missing binary / timeout / non-zero exit / parse failure) into
 * {@link BackendDiagnostic} values. Subprocess-specific detail never leaks to
 * callers.
 *
 * The subprocess invocation is abstracted behind a {@link ProcessRunner} seam
 * so unit tests can supply a deterministic mock without spawning a real
 * process or depending on the external binary.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md (phase 1).
 *
 * @module integrations/codebase-memory/client
 */

import { execFile } from 'node:child_process';
import { createDiagnostic, type BackendDiagnostic } from '@/integrations/codebase-memory/types.js';

/** Raw outcome of running the CLI binary. */
export interface ProcessRunResult {
  /** Process exit code, or null if killed by signal. */
  exitCode: number | null;
  /** Signal that terminated the process, if any. */
  signal: NodeJS.Signals | null;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** True if the process was killed because it exceeded its timeout. */
  timedOut: boolean;
  /** True if the binary itself could not be found / spawned (ENOENT). */
  spawnFailed: boolean;
}

/**
 * Abstraction over the actual subprocess invocation. Tests inject a mock; the
 * default implementation uses {@link execFile}.
 */
export type ProcessRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number }
) => Promise<ProcessRunResult>;

/** Options for {@link CodebaseMemoryClient}. */
export interface CodebaseMemoryClientOptions {
  /** CLI command / binary path. Default: `codebase-memory-mcp`. */
  command?: string;
  /** Per-invocation timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Injectable process runner (primarily for tests). */
  runner?: ProcessRunner;
}

/**
 * Discriminated result of a single tool invocation. Either parsed JSON data,
 * or a normalized diagnostic — never a thrown subprocess error.
 *
 * @typeParam T - expected parsed payload shape.
 */
export type ClientCallResult<T> =
  | { ok: true; data: T; stderr: string }
  | { ok: false; diagnostic: BackendDiagnostic };

const DEFAULT_COMMAND = 'codebase-memory-mcp';
const DEFAULT_TIMEOUT_MS = 10_000;

/** Truncate raw output so diagnostics never embed huge dumps. */
function summarize(text: string, max = 300): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}… (truncated)`;
}

/**
 * Default {@link ProcessRunner} backed by `node:child_process` `execFile`.
 * Never rejects; classifies spawn failures and timeouts into the result shape.
 */
export const defaultProcessRunner: ProcessRunner = (command, args, options) =>
  new Promise<ProcessRunResult>((resolve) => {
    execFile(
      command,
      args,
      { timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as
          | (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals })
          | null;
        const spawnFailed = !!err && err.code === 'ENOENT';
        // execFile reports a timeout via killed + SIGTERM.
        const timedOut = !!err && (err.killed === true || err.signal === 'SIGTERM');
        const exitCode =
          err && typeof err.code === 'number' ? (err.code as number) : err ? null : 0;
        resolve({
          exitCode,
          signal: err?.signal ?? null,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut: timedOut && !spawnFailed,
          spawnFailed,
        });
      }
    );
  });

/**
 * Client for the `codebase-memory-mcp` CLI backend.
 *
 * @example
 * ```ts
 * const client = new CodebaseMemoryClient({ timeoutMs: 5000 });
 * const res = await client.call<{ projects: unknown[] }>('list_projects');
 * if (res.ok) {
 *   // use res.data
 * } else {
 *   // surface res.diagnostic
 * }
 * ```
 */
export class CodebaseMemoryClient {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly runner: ProcessRunner;

  constructor(options: CodebaseMemoryClientOptions = {}) {
    this.command = options.command ?? DEFAULT_COMMAND;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? defaultProcessRunner;
  }

  /** The configured CLI command / binary path. */
  getCommand(): string {
    return this.command;
  }

  /**
   * Invoke a Codebase Memory tool via `cli <tool> [json-args]`.
   *
   * Returns a discriminated result: parsed JSON on success, or a normalized
   * diagnostic on any failure. Never throws for subprocess-level conditions.
   *
   * @param tool - the tool name (e.g. `list_projects`, `search_graph`).
   * @param args - optional argument object, serialized to a single JSON arg.
   * @typeParam T - expected parsed payload shape.
   */
  async call<T = unknown>(
    tool: string,
    args?: Record<string, unknown>
  ): Promise<ClientCallResult<T>> {
    const cliArgs = ['cli', tool];
    if (args !== undefined) {
      cliArgs.push(JSON.stringify(args));
    }

    let run: ProcessRunResult;
    try {
      run = await this.runner(this.command, cliArgs, { timeoutMs: this.timeoutMs });
    } catch {
      // Defensive: the runner contract is non-throwing, but normalize anyway.
      return {
        ok: false,
        diagnostic: createDiagnostic(
          'backend-error',
          `Failed to invoke the Codebase Memory backend tool "${tool}".`
        ),
      };
    }

    if (run.spawnFailed) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          'binary-missing',
          `Codebase Memory backend "${this.command}" was not found.`,
          {
            nextSteps: [
              `Ensure "${this.command}" is installed and on PATH, or configure queryBackends.codebaseMemory.command.`,
            ],
          }
        ),
      };
    }

    if (run.timedOut) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          'timeout',
          `Codebase Memory tool "${tool}" timed out after ${this.timeoutMs}ms and was terminated.`
        ),
      };
    }

    if (run.exitCode !== 0) {
      const detail = summarize(run.stderr || run.stdout);
      return {
        ok: false,
        diagnostic: createDiagnostic(
          'backend-error',
          `Codebase Memory tool "${tool}" failed${detail ? `: ${detail}` : '.'}`
        ),
      };
    }

    try {
      const data = JSON.parse(run.stdout) as T;
      return { ok: true, data, stderr: run.stderr };
    } catch {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          'parse-error',
          `Codebase Memory tool "${tool}" returned output that could not be parsed as JSON. Output: ${summarize(
            run.stdout
          )}`
        ),
      };
    }
  }
}
