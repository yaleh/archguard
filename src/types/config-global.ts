import type { DiagramConfig } from './config-diagram.js';
import type { ProjectSemantics } from './extensions/project-semantics.js';
import type { MermaidConfig, OutputFormat } from './config-mermaid.js';
import type { FitnessConfig } from '../analysis/fitness/rule-types.js';

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
}

export interface ArchGuardConfig extends GlobalConfig {
  diagrams: DiagramConfig[];
}
