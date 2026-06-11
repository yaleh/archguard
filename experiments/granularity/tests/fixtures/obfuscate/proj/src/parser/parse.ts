import type { Diagram, DiagramKind } from '../types/model';
import { SvgRenderer } from '@x/mermaid/renderer';

/* Block comment: parses raw mermaid text into a Diagram. */
export function parseDiagram(source: string): Diagram | undefined {
  const matched = source.match(/classDiagram|flowchart/);
  const { length } = source;
  if (!matched || length === 0) {
    return undefined;
  }
  return new SvgRenderer();
}

export const PARSER_VERSION = '1.0.0';

/* Shorthand property regression: the property side must be renamed too. */
export function describeDiagram(diagram: Diagram): { kind: DiagramKind; scale: number } {
  const kind = diagram.kind;
  const scale = 2;
  return { kind, scale };
}
