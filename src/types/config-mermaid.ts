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

export type OutputFormat = 'mermaid' | 'json';
