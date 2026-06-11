/**
 * Domain model for the fixture mermaid diagram project.
 * This JSDoc is a semantic bomb that must be removed.
 */

/** A renderable diagram. */
export interface Diagram {
  /** Which kind of diagram this is. */
  kind: DiagramKind;
  /** Renders the diagram into source text. */
  render(scale: number): string;
}

// Theme union: 'dark' also appears in a value position in renderer.ts.
export type Theme = 'forest' | 'dark';

export enum DiagramKind {
  CLASS = 'classDiagram',
  FLOW = 'flowchart',
}

// Top-level const (entity namespace).
export const DEFAULT_THEME: Theme = 'forest';
