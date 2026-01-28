/**
 * CLI Types and Interfaces
 */

export interface CLIConfig {
  command: string;
  args: string[];
  timeout: number;
}

export interface Config {
  source: string | string[];
  output?: string;
  outputDir: string;
  format: 'mermaid' | 'json';
  exclude: string[];
  cli: CLIConfig;
  ai?: {
    model?: string;
    timeout?: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
  concurrency?: number;
  verbose?: boolean;
}

export interface AnalyzeOptions {
  source: string | string[];
  output?: string;
  format: 'mermaid' | 'json';
  exclude?: string[];
  cache: boolean;
  concurrency?: number;
  verbose?: boolean;
  // Phase 4.2: CLI parameter integration
  cliCommand?: string;
  cliArgs?: string;
  outputDir?: string;
  name?: string;
}
