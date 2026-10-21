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
