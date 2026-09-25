import type { OutputFormat } from './config-mermaid.js';

export interface CLIOptions {
  config?: string;
  diagrams?: string[];
  sources?: string[];
  lang?: string;
  format?: OutputFormat;
  outputDir?: string;
  workDir?: string;
  cacheDir?: string;
  exclude?: string[];
  cache?: boolean;
  concurrency?: number;
  verbose?: boolean;
  cliCommand?: string;
  cliArgs?: string;
  mermaidTheme?: 'default' | 'forest' | 'dark' | 'neutral';
  mermaidRenderer?: 'isomorphic' | 'cli';
  atlasLayers?: string;
  atlasStrategy?: string;
  atlasNoTests?: boolean;
  atlasIncludeTests?: boolean;
  atlasProtocols?: string;
  atlasEntryPattern?: string;
  atlasCapabilityMode?: string;
  level?: 'package' | 'class' | 'method';
  name?: string;
  includeTests?: boolean;
  testsOnly?: boolean;
  /** Test directories to analyze (default: inferred under the analyzed source root). */
  testSources?: string[];
  includeGit?: boolean;
  gitSinceDays?: number;
  gitMaxCommits?: number;
  gim?: boolean;
  archHealth?: boolean;
  driftBase?: string;
  driftThreshold?: string;
}
