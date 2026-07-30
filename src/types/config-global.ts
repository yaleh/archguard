import type { DiagramConfig } from './config-diagram.js';
import type { ProjectSemantics } from './extensions/project-semantics.js';
import type { MermaidConfig, OutputFormat } from './config-mermaid.js';
import type { FitnessConfig } from './fitness-rules.js';
import type { ParserRuntimePolicy } from './parser-runtime.js';

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
  /**
   * Per-language Tree-sitter runtime policy (auto|native|wasm). The
   * ARCHGUARD_PARSER_RUNTIME environment variable takes precedence when set.
   * See docs/user-guide/parser-runtime.md.
   */
  parserRuntime?: ParserRuntimePolicy;
  /**
   * Explicitly trusted external module root used to resolve the optional
   * native tree-sitter packages. Also configurable via
   * ARCHGUARD_NATIVE_MODULE_ROOT. When unset, native modules resolve only
   * from ArchGuard's own package scope — never from the analyzed project.
   */
  nativeModuleRoot?: string;
  /**
   * Go Atlas / gopls reliability bounds (TASK-44).
   */
  atlas?: {
    /**
     * Total time budget (ms) for gopls startup + workspace load before the Go
     * plugin degrades to tree-sitter-only analysis (no gopls call graph).
     * Default: 120000 (120s). The ARCHGUARD_GOPLS_TIMEOUT_MS environment
     * variable takes precedence when set. See
     * docs/user-guide/golang-plugin-usage.md.
     */
    goplsTimeoutMs?: number;
  };
}

export interface ArchGuardConfig extends GlobalConfig {
  diagrams: DiagramConfig[];
}
