import { describe, it, expect } from 'vitest';
import { inlineEdgeStyles } from '@/mermaid/renderer.js';

describe('inlineEdgeStyles', () => {
  it('adds fill:none to empty style on flowchart-link path', () => {
    const svg = `<path class="flowchart-link" style=";"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="fill:none;"');
  });

  it('preserves existing style values when adding fill:none', () => {
    const svg = `<path class="flowchart-link" style="stroke-width:2;"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="stroke-width:2;fill:none;"');
  });

  it('does not modify paths without flowchart-link class', () => {
    const svg = `<path class="other-class" style="stroke-width:2;"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
  });

  it('is idempotent when fill:none is already present', () => {
    const svg = `<path class="flowchart-link" style="fill:none;stroke-width:2;"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
    expect((result.match(/fill:none/g) ?? []).length).toBe(1);
  });

  it('works with realistic Mermaid SVG snippet', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
  <style>#graph .flowchart-link { fill: none; stroke: #333; }</style>
  <g id="graph">
    <path class="edge-thickness-normal edge-pattern-solid flowchart-link" style=";fill:none" d="M100,100 L200,200"></path>
    <rect class="node-shape" style="fill:#fff;" width="100" height="50"></rect>
  </g>
</svg>`;
    const result = inlineEdgeStyles(svg);
    // The edge path should have fill:none inline
    expect(result).toMatch(/<path[^>]*flowchart-link[^>]*style="[^"]*fill:none/);
    // The rect should be unchanged
    expect(result).toContain('<rect class="node-shape" style="fill:#fff;"');
  });
});
