export type DetailLevel = 'package' | 'class' | 'method';

export interface MermaidConfig {
  renderer?: 'isomorphic' | 'cli';
  theme?: 'default' | 'forest' | 'dark' | 'neutral';
  transparentBackground?: boolean;
}

export const defaultMermaidConfig: MermaidConfig = {
  renderer: 'isomorphic',
  theme: 'default',
  transparentBackground: false,
};

/**
 * Diagram output formats.
 *
 * `plantuml` is emit-only: ArchGuard writes deterministic `.puml` source and
 * performs no rendering (there is no PlantUML renderer in v2).
 */
export type OutputFormat = 'mermaid' | 'json' | 'plantuml';

/**
 * The canonical shape of a format selection: an ordered, de-duplicated set.
 *
 * Every entry point (config file, CLI, MCP, programmatic) speaks this one
 * shape; `resolveFormats()` in `src/cli/utils/format-selection.ts` normalizes
 * it and applies source precedence.
 */
export type OutputFormats = OutputFormat[];
