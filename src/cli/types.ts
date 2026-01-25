/**
 * CLI Types and Interfaces
 */

export interface AnalyzeOptions {
  source: string;
  output?: string;
  format: 'plantuml' | 'json' | 'svg';
  exclude?: string[];
  cache: boolean;
  concurrency?: number;
  verbose?: boolean;
}
