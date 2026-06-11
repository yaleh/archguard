// Renderer for mermaid diagrams (line comment bomb).
import mermaid from 'isomorphic-mermaid';
import { join } from 'node:path';
import { Diagram, DiagramKind, Theme, DEFAULT_THEME } from '@x/types/model';

/** Renders diagrams as SVG strings. */
export class SvgRenderer implements Diagram {
  kind = DiagramKind.CLASS;
  private theme: Theme = DEFAULT_THEME;

  render(scale: number): string {
    const header = 'classDiagram'; // same value as DiagramKind.CLASS initializer
    const parts = [header, this.theme].map((part) => part.trim());
    const diagram = `diagram ${parts.join(' ')}`;
    mermaid.render(join('out', diagram), String(scale));
    return diagram;
  }

  setTheme(theme: Theme): void {
    if (theme === 'dark') {
      this.theme = theme;
    }
  }
}
