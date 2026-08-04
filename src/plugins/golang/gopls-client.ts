/**
 * GoplsClient - LSP client for gopls (Go language server)
 *
 * Provides semantic analysis capabilities for Go code including:
 * - Interface implementation detection
 * - Type information queries
 * - Symbol resolution
 *
 * Reliability bounds (TASK-44 / TASK-47):
 * - A configurable startup budget bounds gopls startup + workspace load.
 *   Precedence: env ARCHGUARD_GOPLS_TIMEOUT_MS > resolved config
 *   atlas.goplsTimeoutMs (honours --config <path>) > default (120s). The budget
 *   covers the previously unbounded `gopls version` probe and the LSP
 *   `initialize` handshake.
 * - On budget exhaustion the client cancels the gopls operation, reaps every
 *   child process, raises GoplsTimeoutError, and sets a process-wide
 *   poison-pill so gopls is never re-spawned within the same process.
 * - Every spawned child (version probe + serve) is tracked and reaped on
 *   success, timeout, error, dispose, and process exit — no orphans.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

// ---------------------------------------------------------------------------
// Timeout budget configuration
// ---------------------------------------------------------------------------

/** Default total budget (ms) for gopls startup + workspace load. */
export const DEFAULT_GOPLS_TIMEOUT_MS = 120_000;

/** Environment variable overriding the gopls timeout budget. */
export const GOPLS_TIMEOUT_ENV = 'ARCHGUARD_GOPLS_TIMEOUT_MS';

/**
 * Resolve the effective gopls timeout budget (ms).
 *
 * Precedence: `ARCHGUARD_GOPLS_TIMEOUT_MS` env override → `configMs`
 * (e.g. `atlas.goplsTimeoutMs` from archguard.config.json) → default (120s).
 * Invalid / non-positive values from any source fall through to the next
 * source in the chain so a malformed override can never disable the bound.
 */
export function resolveGoplsTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  configMs?: number
): number {
  const raw = env[GOPLS_TIMEOUT_ENV];
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    // Invalid env value → fall through to config / default.
  }
  if (configMs !== undefined && Number.isFinite(configMs) && configMs > 0) {
    return Math.floor(configMs);
  }
  return DEFAULT_GOPLS_TIMEOUT_MS;
}

/**
 * Read `atlas.goplsTimeoutMs` from `archguard.config.json` in `cwd` (default:
 * process.cwd(), matching the CLI's default config discovery). Returns
 * undefined when the file is absent / unreadable / malformed JSON, or when
 * `atlas.goplsTimeoutMs` is absent, non-numeric, or non-positive — callers
 * then fall through resolveGoplsTimeoutMs's precedence chain.
 *
 * Scope note: this covers the cwd-relative fallback only. The preferred path
 * is for GoPlugin.initialize to supply the resolved config's value via
 * resolveGoplsTimeoutMs(env, resolvedMs) so that --config <path> and
 * programmatic configs are honoured. This function is retained for backward
 * compatibility and as the last-resort fallback inside
 * resolveEffectiveGoplsTimeoutMs.
 */
export function readGoplsTimeoutFromConfigFile(cwd: string = process.cwd()): number | undefined {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'archguard.config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { atlas?: { goplsTimeoutMs?: unknown } } | null;
    const value = parsed?.atlas?.goplsTimeoutMs;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return Math.floor(value);
  } catch {
    return undefined;
  }
}

/**
 * Resolve the effective gopls budget from cwd config file fallback:
 * env ARCHGUARD_GOPLS_TIMEOUT_MS > config-file atlas.goplsTimeoutMs > 120s.
 *
 * This is the backward-compat fallback for when no resolved config
 * (PluginInitConfig.languageSpecific) is available. Prefer the resolved
 * config path (resolveGoplsTimeoutMs with a caller-supplied configMs)
 * when the loaded config is in scope (TASK-47).
 */
export function resolveEffectiveGoplsTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): number {
  return resolveGoplsTimeoutMs(env, readGoplsTimeoutFromConfigFile(cwd));
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Raised when a gopls stage exceeds its configured time budget. */
export class GoplsTimeoutError extends Error {
  readonly budgetExceeded: boolean;
  readonly stage?: string;

  constructor(message: string, opts: { budgetExceeded?: boolean; stage?: string } = {}) {
    super(message);
    this.name = 'GoplsTimeoutError';
    this.budgetExceeded = opts.budgetExceeded ?? false;
    this.stage = opts.stage;
  }
}

/** Raised when gopls is disabled process-wide by the poison-pill. */
export class GoplsPoisonedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoplsPoisonedError';
  }
}

// ---------------------------------------------------------------------------
// Process-wide poison-pill
// ---------------------------------------------------------------------------
//
// Once gopls blows its startup budget in a process we never spawn it again in
// that process: a hung gopls is almost always environmental (huge module,
// broken toolchain) and retrying only re-introduces the stall. The poisoned
// state is surfaced through getGoplsDiagnostics().

const poisonState: { poisoned: boolean; reason: string | null } = {
  poisoned: false,
  reason: null,
};

/** Whether gopls has been poison-pill disabled in this process. */
export function isGoplsPoisoned(): boolean {
  return poisonState.poisoned;
}

/** The reason gopls was poisoned, or null when not poisoned. */
export function getGoplsPoisonReason(): string | null {
  return poisonState.reason;
}

/** Mark gopls as poisoned for the remainder of this process. */
export function poisonGopls(reason: string): void {
  poisonState.poisoned = true;
  poisonState.reason = reason;
}

/**
 * Clear the poison-pill. Intended for tests and long-lived hosts that want to
 * re-arm gopls after the environment has changed.
 */
export function resetGoplsPoison(): void {
  poisonState.poisoned = false;
  poisonState.reason = null;
}

/** Human-readable diagnostics for the gopls subsystem (poison state + budget). */
export function getGoplsDiagnostics(): readonly string[] {
  const lines = [
    `gopls: startup budget default ${DEFAULT_GOPLS_TIMEOUT_MS}ms (override via ${GOPLS_TIMEOUT_ENV})`,
  ];
  if (poisonState.poisoned) {
    lines.push(
      `gopls: POISON-PILL active — gopls disabled for this process (${poisonState.reason ?? 'unknown reason'})`
    );
  } else {
    lines.push('gopls: poison-pill inactive');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Global child-process reaper
// ---------------------------------------------------------------------------
//
// Track every live gopls child so we can guarantee no orphan survives process
// exit (CLI exit or MCP shutdown). A single 'exit' handler is registered lazily
// on first spawn; kill() is synchronous and safe in the 'exit' hook.

const liveGoplsChildren = new Set<ChildProcess>();
let globalReaperRegistered = false;

function registerGlobalReaper(): void {
  if (globalReaperRegistered) {
    return;
  }
  globalReaperRegistered = true;
  process.on('exit', () => {
    for (const child of liveGoplsChildren) {
      try {
        child.kill('SIGKILL');
      } catch {
        // best-effort reaping; ignore
      }
    }
    liveGoplsChildren.clear();
  });
}

interface LSPMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

/** LSP hover response (MarkupContent | MarkedString | MarkedString[]) */
interface HoverResponse {
  contents:
    | string
    | { value: string; language?: string; kind?: string }
    | Array<string | { value: string; language?: string; kind?: string }>;
}

interface Location {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface ImplementationResult {
  structName: string;
  filePath: string;
  line: number;
}

interface TypeInfo {
  name: string;
  kind: string;
  signature?: string;
}

export class GoplsClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private messageBuffer = '';
  private initialized = false;
  private workspaceRoot = '';
  /** Per-instance set of live child processes (serve + version probe). */
  private liveChildren = new Set<ChildProcess>();
  /** Total startup budget (ms). */
  private readonly budgetMs: number;

  constructor(
    private goplsPath: string = 'gopls',
    private timeout: number = 30000, // 30s default per-request timeout
    budgetMs?: number
  ) {
    this.budgetMs = budgetMs ?? resolveEffectiveGoplsTimeoutMs();
  }

  /**
   * Initialize gopls language server.
   *
   * The entire startup sequence (version probe + spawn + LSP initialize
   * handshake) is bounded by the configured budget. On budget exhaustion the
   * operation is cancelled, all children are reaped, the process-wide
   * poison-pill is set, and a GoplsTimeoutError is thrown.
   */
  async initialize(workspaceRoot: string, budgetMs?: number): Promise<void> {
    if (this.initialized) {
      return; // Already initialized
    }

    if (!workspaceRoot) {
      throw new Error('Workspace root is required');
    }

    if (isGoplsPoisoned()) {
      throw new GoplsPoisonedError(
        `gopls is disabled in this process (poison-pill): ${getGoplsPoisonReason()}`
      );
    }

    this.workspaceRoot = workspaceRoot;
    const budget = budgetMs ?? this.budgetMs;

    try {
      await this.runWithBudget(this.startup(workspaceRoot, budget), budget, 'startup');
      this.initialized = true;
    } catch (error) {
      // Always reap on failure so no child is left behind.
      this.reapAll();
      if (error instanceof GoplsTimeoutError && error.budgetExceeded) {
        poisonGopls(`startup exceeded budget of ${budget}ms`);
      }
      if (error instanceof GoplsTimeoutError || error instanceof GoplsPoisonedError) {
        throw error;
      }
      throw new Error(`Failed to initialize gopls: ${error}`);
    }
  }

  /**
   * Startup sequence executed under the budget timer.
   */
  private async startup(workspaceRoot: string, budget: number): Promise<void> {
    // Verify gopls binary exists (bounded + reaped).
    try {
      await this.checkGoplsAvailable(budget);
    } catch (error) {
      if (error instanceof GoplsTimeoutError) {
        throw error;
      }
      throw new Error(`gopls binary not found at: ${this.goplsPath}`);
    }

    // Spawn gopls process
    this.process = this.trackProcess(
      spawn(this.goplsPath, ['serve', '-rpc.trace'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create gopls process streams');
    }

    // Set up message handling
    this.process.stdout.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.process.stderr?.on('data', (_data: Buffer) => {
      // Log stderr for debugging, but don't fail
      // gopls writes trace info to stderr
    });

    this.process.on('error', (error) => {
      this.handleProcessError(error);
    });

    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Send LSP initialize request
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      capabilities: {
        textDocument: {
          implementation: {
            linkSupport: true,
          },
          hover: {
            contentFormat: ['plaintext', 'markdown'],
          },
        },
      },
    });

    // Send initialized notification
    this.sendNotification('initialized', {});
  }

  /**
   * Run a unit of work under a hard time budget. When the budget fires first
   * the returned promise rejects with a GoplsTimeoutError; the inner promise
   * is still awaited/swallowed so it cannot produce an unhandled rejection.
   */
  private runWithBudget<T>(work: Promise<T>, budget: number, stage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new GoplsTimeoutError(`gopls ${stage} exceeded budget of ${budget}ms`, {
            budgetExceeded: true,
            stage,
          })
        );
      }, budget);
      // Do not keep the event loop alive solely for this timer.
      timer.unref?.();

      work.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  /**
   * Check if gopls is available. Bounded by `timeoutMs`; the probe child is
   * reaped on both timeout and completion.
   */
  private checkGoplsAvailable(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = this.trackProcess(spawn(this.goplsPath, ['version']));
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.reapProcess(proc);
        reject(
          new GoplsTimeoutError(`gopls version probe exceeded budget of ${timeoutMs}ms`, {
            budgetExceeded: true,
            stage: 'version-probe',
          })
        );
      }, timeoutMs);
      timer.unref?.();

      proc.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.reapProcess(proc);
        reject(error);
      });

      proc.on('exit', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.untrackProcess(proc);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`gopls exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Get implementations of an interface
   *
   * Strategy: Search for all method receivers in the codebase and check
   * if they implement all interface methods
   */
  async getImplementations(
    typeName: string,
    filePath: string,
    line: number
  ): Promise<ImplementationResult[]> {
    if (!this.initialized) {
      throw new Error('GoplsClient not initialized. Call initialize() first.');
    }

    // Validate inputs
    if (line < 0) {
      return [];
    }

    try {
      // Ensure file exists
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.workspaceRoot, filePath);

      if (!(await fs.pathExists(absolutePath))) {
        return [];
      }

      // Open document
      const content = await fs.readFile(absolutePath, 'utf-8');
      this.openDocument(absolutePath, content);

      // First, try textDocument/implementation
      let result = await this.sendRequest<Location | Location[]>('textDocument/implementation', {
        textDocument: {
          uri: `file://${absolutePath}`,
        },
        position: {
          line: line - 1, // LSP is 0-indexed
          character: 5, // Position on the interface name
        },
      });

      // If that doesn't work, try finding the interface type position
      if (!result || (Array.isArray(result) && result.length === 0)) {
        // Try to find where interface is used as a type
        const lines = content.split('\n');
        if (line <= lines.length) {
          const interfaceLine = lines[line - 1];
          const typeIndex = interfaceLine.indexOf(typeName);
          if (typeIndex !== -1) {
            result = await this.sendRequest<Location | Location[]>('textDocument/implementation', {
              textDocument: {
                uri: `file://${absolutePath}`,
              },
              position: {
                line: line - 1,
                character: typeIndex,
              },
            });
          }
        }
      }

      // Close document
      this.closeDocument(absolutePath);

      // Parse results
      if (!result) {
        return [];
      }

      const locations: Location[] = Array.isArray(result) ? result : [result];
      const implementations: ImplementationResult[] = [];

      for (const loc of locations) {
        if (loc && loc.uri) {
          const uri = loc.uri.replace('file://', '');
          const implLine = loc.range.start.line + 1; // Convert back to 1-indexed

          // Extract struct name from the implementation
          const structName = await this.extractStructNameAtLocation(uri, implLine);

          if (structName) {
            implementations.push({
              structName,
              filePath: uri,
              line: implLine,
            });
          }
        }
      }

      return implementations;
    } catch {
      // Return empty array on error (non-fatal)
      return [];
    }
  }

  /**
   * Get type information for a symbol
   */
  async getTypeInfo(symbol: string, filePath: string, line: number): Promise<TypeInfo | null> {
    if (!this.initialized) {
      throw new Error('GoplsClient not initialized. Call initialize() first.');
    }

    try {
      // Ensure file exists
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.workspaceRoot, filePath);

      if (!(await fs.pathExists(absolutePath))) {
        return null;
      }

      // Open document
      const content = await fs.readFile(absolutePath, 'utf-8');
      this.openDocument(absolutePath, content);

      // Request hover information (contains type info)
      const result = await this.sendRequest<HoverResponse>('textDocument/hover', {
        textDocument: {
          uri: `file://${absolutePath}`,
        },
        position: {
          line: line - 1, // LSP is 0-indexed
          character: 0,
        },
      });

      // Close document
      this.closeDocument(absolutePath);

      if (!result || !result.contents) {
        return null;
      }

      // Extract type info from hover contents
      const contents =
        typeof result.contents === 'string'
          ? result.contents
          : Array.isArray(result.contents)
            ? ''
            : result.contents.value || '';

      return {
        name: symbol,
        kind: 'type',
        signature: contents,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose gopls client and cleanup resources. Always reaps child processes.
   */
  async dispose(): Promise<void> {
    if (!this.initialized && !this.process && this.liveChildren.size === 0) {
      return; // Already disposed
    }

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(new Error('GoplsClient disposed'));
      this.pendingRequests.delete(id);
    }

    // Send shutdown request
    if (this.initialized && this.process) {
      try {
        await this.sendRequest('shutdown', null);
        this.sendNotification('exit', null);
      } catch {
        // Ignore errors during shutdown
      }
    }

    // Reap all child processes (serve + any lingering version probe).
    this.reapAll();

    this.initialized = false;
    this.messageBuffer = '';
  }

  /**
   * Open a document in gopls
   */
  private openDocument(filePath: string, content: string): void {
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: 'go',
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Close a document in gopls
   */
  private closeDocument(filePath: string): void {
    this.sendNotification('textDocument/didClose', {
      textDocument: {
        uri: `file://${filePath}`,
      },
    });
  }

  /**
   * Extract struct name at a given location
   */
  private async extractStructNameAtLocation(
    filePath: string,
    line: number
  ): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      if (line > lines.length) {
        return null;
      }

      // Look for struct name pattern: "type StructName struct"
      const targetLine = lines[line - 1];
      const structMatch = targetLine.match(/type\s+(\w+)\s+struct/);

      if (structMatch) {
        return structMatch[1];
      }

      // Look for method receiver: "func (r *StructName) MethodName"
      const methodMatch = targetLine.match(/func\s+\([^)]*\*?(\w+)\)/);

      if (methodMatch) {
        return methodMatch[1];
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Send LSP request and wait for response
   */
  private async sendRequest<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.process || !this.process.stdin) {
      throw new Error('gopls process not available');
    }

    const id = this.nextId++;

    const message: LSPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      // Store request
      this.pendingRequests.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timer,
      });

      // Send message
      const messageStr = JSON.stringify(message);
      const contentLength = Buffer.byteLength(messageStr, 'utf-8');
      const header = `Content-Length: ${contentLength}\r\n\r\n`;

      this.process.stdin.write(header + messageStr);
    });
  }

  /**
   * Send LSP notification (no response expected)
   */
  private sendNotification(method: string, params: unknown): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const messageStr = JSON.stringify(message);
    const contentLength = Buffer.byteLength(messageStr, 'utf-8');
    const header = `Content-Length: ${contentLength}\r\n\r\n`;

    this.process.stdin.write(header + messageStr);
  }

  /**
   * Handle incoming data from gopls
   */
  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString();

    // Process complete messages
    while (true) {
      // Look for Content-Length header
      const headerMatch = this.messageBuffer.match(/Content-Length: (\d+)\r\n\r\n/);

      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerLength = headerMatch[0].length;
      const messageStart = headerMatch.index + headerLength;
      const messageEnd = messageStart + contentLength;

      // Check if we have the complete message
      if (this.messageBuffer.length < messageEnd) {
        break;
      }

      // Extract message
      const messageStr = this.messageBuffer.substring(messageStart, messageEnd);
      this.messageBuffer = this.messageBuffer.substring(messageEnd);

      // Parse and handle message
      try {
        const message = JSON.parse(messageStr) as LSPMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse LSP message:', error);
      }
    }
  }

  /**
   * Handle parsed LSP message
   */
  private handleMessage(message: LSPMessage): void {
    // Handle response to request
    if (message.id !== undefined) {
      const request = this.pendingRequests.get(message.id);

      if (request) {
        clearTimeout(request.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          request.reject(new Error(message.error.message));
        } else {
          request.resolve(message.result);
        }
      }
    }

    // Handle notifications from server (e.g., diagnostics)
    // We can ignore these for now
  }

  /**
   * Handle gopls process error
   */
  private handleProcessError(error: Error): void {
    // Reject all pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle gopls process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.initialized = false;
    this.process = null;

    // Reject all pending requests
    const error = new Error(`gopls process exited: code=${code}, signal=${signal}`);

    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Child-process tracking / reaping
  // -------------------------------------------------------------------------

  private trackProcess(proc: ChildProcess): ChildProcess {
    this.liveChildren.add(proc);
    liveGoplsChildren.add(proc);
    registerGlobalReaper();
    return proc;
  }

  private untrackProcess(proc: ChildProcess): void {
    this.liveChildren.delete(proc);
    liveGoplsChildren.delete(proc);
  }

  private reapProcess(proc: ChildProcess): void {
    try {
      // SIGKILL: a hung gopls may ignore SIGTERM; guarantee no survivor.
      proc.kill('SIGKILL');
    } catch {
      // best-effort
    }
    this.untrackProcess(proc);
  }

  /** Kill and forget every tracked child process. */
  private reapAll(): void {
    for (const proc of this.liveChildren) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // best-effort
      }
      liveGoplsChildren.delete(proc);
    }
    this.liveChildren.clear();
    this.process = null;
  }
}
