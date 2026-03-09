import type { DiagramConfig } from './config-diagram.js';
import type { MermaidConfig, OutputFormat } from './config-mermaid.js';

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
}

export interface ArchGuardConfig extends GlobalConfig {
  diagrams: DiagramConfig[];
}
