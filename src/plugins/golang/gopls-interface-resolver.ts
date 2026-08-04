import { InterfaceMatcher } from './interface-matcher.js';
import {
  GoplsClient,
  GoplsTimeoutError,
  isGoplsPoisoned,
  getGoplsPoisonReason,
} from './gopls-client.js';
import type { GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';

type StructWithPackage = GoRawStruct & { packageName: string };
type InterfaceWithPackage = GoRawInterface & { packageName: string };

/**
 * Optional construction knobs for the resolver. All fields are optional so the
 * existing `new GoplsInterfaceResolver()` call sites keep working; the budget
 * itself defaults to the env-derived value inside GoplsClient.
 */
export interface GoplsResolverOptions {
  /** Path to the gopls binary (default: `gopls` on PATH). */
  goplsPath?: string;
  /** Per-request LSP timeout (ms). Defaults to GoplsClient's 30s. */
  timeoutMs?: number;
  /**
   * Total gopls startup budget (ms). Defaults to the env-derived budget
   * (ARCHGUARD_GOPLS_TIMEOUT_MS, or 120s).
   */
  budgetMs?: number;
  /** Sink for degradation warnings (default: console.warn → stderr). */
  warn?: (message: string) => void;
}

export class GoplsInterfaceResolver {
  private goplsClient: GoplsClient | null = null;
  private matcher: InterfaceMatcher;
  private degraded = false;
  private degradedReason: string | null = null;
  private readonly options: GoplsResolverOptions;
  private readonly warn: (message: string) => void;

  constructor(options: GoplsResolverOptions = {}) {
    this.matcher = new InterfaceMatcher();
    this.options = options;
    this.warn = options.warn ?? ((message: string): void => console.warn(message));
  }

  async initialize(workspaceRoot: string): Promise<void> {
    // Reset per-instance degradation state on each (re)initialization.
    this.degraded = false;
    this.degradedReason = null;

    // Honour the process-wide poison-pill: never spawn gopls again this process.
    if (isGoplsPoisoned()) {
      this.markDegraded(`gopls disabled by poison-pill (${getGoplsPoisonReason() ?? 'timeout'})`);
      return;
    }

    let client: GoplsClient;
    try {
      client = new GoplsClient(
        this.options.goplsPath ?? 'gopls',
        this.options.timeoutMs ?? 30000,
        this.options.budgetMs
      );
    } catch (error) {
      this.markDegraded(`gopls unavailable: ${error}`);
      return;
    }

    try {
      await client.initialize(workspaceRoot);
      this.goplsClient = client;
    } catch (error) {
      // Ensure the child is reaped even on timeout/error.
      try {
        await client.dispose();
      } catch {
        // best-effort cleanup
      }
      const detail = error instanceof Error ? error.message : String(error);
      const reason =
        error instanceof GoplsTimeoutError
          ? `gopls timed out (${detail})`
          : `gopls unavailable (${detail})`;
      this.markDegraded(reason);
    }
  }

  async resolve(
    structs: StructWithPackage[],
    interfaces: InterfaceWithPackage[]
  ): Promise<InferredImplementation[]> {
    return this.matcher.matchWithGopls(structs, interfaces, this.goplsClient);
  }

  resolveSync(
    structs: StructWithPackage[],
    interfaces: InterfaceWithPackage[]
  ): InferredImplementation[] {
    return this.matcher.matchImplicitImplementations(structs, interfaces);
  }

  isGoplsAvailable(): boolean {
    return this.goplsClient !== null;
  }

  /** Whether the resolver degraded to tree-sitter-only matching. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** The reason for degradation, or null when running with full gopls support. */
  getDegradedReason(): string | null {
    return this.degradedReason;
  }

  private markDegraded(reason: string): void {
    this.degraded = true;
    this.degradedReason = reason;
    this.goplsClient = null;
    this.warn(
      `⚠ Go analysis degraded — ${reason}. Falling back to tree-sitter-only interface matching; gopls call-graph layers will be missing.`
    );
  }

  async dispose(): Promise<void> {
    if (this.goplsClient) {
      try {
        await this.goplsClient.dispose();
      } catch (error) {
        console.warn('Error disposing gopls client:', error);
      }
      this.goplsClient = null;
    }
  }
}
