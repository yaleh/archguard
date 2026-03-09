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
  atlas?: boolean;
  noAtlas?: boolean;
  atlasLayers?: string;
  atlasStrategy?: string;
  atlasNoTests?: boolean;
  atlasIncludeTests?: boolean;
  atlasProtocols?: string;
  level?: 'package' | 'class' | 'method';
  name?: string;
}
