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

  it('adds stroke from .flowchart-link CSS when inline style has no stroke', () => {
    const svg = `<svg><style>#id .flowchart-link{stroke:#333333;fill:none;}</style><path class="flowchart-link" style=";" d="M0,0 L100,100"></path></svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toMatch(/style="fill:none;stroke:#333333;"/);
  });
});

describe('inlineEdgeStyles – background rect patching', () => {
  it('adds fill:none to background rect with empty style', () => {
    // Edge label background rects from Mermaid SVG have class="background" style=""
    // Without CSS applied (librsvg), they render as solid black.
    const svg = `<rect class="background" style="" x="-2" y="-18" width="46" height="26">`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="fill:none;"');
  });

  it('does not modify background rect that already has a fill', () => {
    const svg = `<rect class="background" style="fill:#dafbe1;" x="-2" y="-18" width="46" height="26">`;
    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
  });

  it('patches both flowchart-link paths and background rects in the same SVG', () => {
    const svg = `<svg>
  <path class="flowchart-link" style=";" d="M0,0 L100,100">
  <g class="edgeLabel">
    <rect class="background" style="" x="-2" y="-18" width="46" height="26">
  </g>
</svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toMatch(/<path[^>]*flowchart-link[^>]*style="fill:none;"/);
    expect(result).toMatch(/<rect[^>]*background[^>]*style="fill:none;"/);
  });

  it('does not add fill to background rects without style attribute', () => {
    // A background rect with no style attr at all should not be modified
    // (these are typically dimensionless placeholders)
    const svg = `<rect class="background">`;
    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
  });
});

describe('inlineEdgeStyles – flowchart node rect patching', () => {
  const cssStyle = `<style>#id .node rect,#id .node circle{fill:#ECECFF;stroke:#9370DB;stroke-width:1px;}</style>`;

  it('injects fill/stroke into basic label-container rect with empty style', () => {
    const svg = `<svg>${cssStyle}<rect class="basic label-container" style="" width="126" height="52"></rect></svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toMatch(
      /<rect[^>]*label-container[^>]*style="fill:#ECECFF;stroke:#9370DB;stroke-width:1px;"/
    );
  });

  it('does not patch label-container rect that already has inline fill (idempotent)', () => {
    const svg = `<svg>${cssStyle}<rect class="basic label-container" style="fill:#custom;stroke:#aaa;" width="126" height="52"></rect></svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="fill:#custom;stroke:#aaa;"');
  });

  it('does nothing when no .node rect CSS rule exists in the SVG', () => {
    const svg = `<svg><rect class="basic label-container" style="" width="126" height="52"></rect></svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style=""');
  });

  it('preserves existing non-fill style properties', () => {
    const svg = `<svg>${cssStyle}<rect class="basic label-container" style="stroke-dasharray:4;" width="126" height="52"></rect></svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toMatch(
      /style="stroke-dasharray:4;fill:#ECECFF;stroke:#9370DB;stroke-width:1px;"/
    );
  });

  it('patches all three element types in a combined flowchart SVG', () => {
    const svg = `<svg>
  ${cssStyle}
  <path class="flowchart-link" style=";" d="M0,0 L100,100"></path>
  <rect class="background" style="stroke: none"></rect>
  <rect class="basic label-container" style="" width="126" height="52"></rect>
</svg>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toMatch(/<path[^>]*flowchart-link[^>]*style="fill:none;"/);
    expect(result).toMatch(/<rect[^>]*background[^>]*style="stroke: none;fill:none;"/);
    expect(result).toMatch(
      /<rect[^>]*label-container[^>]*style="fill:#ECECFF;stroke:#9370DB;stroke-width:1px;"/
    );
  });
});

describe('inlineEdgeStyles – text anchor patching', () => {
  it('injects text-anchor:middle into flowchart node label text', () => {
    const svg = `<svg>
  <style>#id .node .label text,#id .icon-shape .label{text-anchor:middle;}</style>
  <g class="node default">
    <g class="label" transform="translate(0,-10.89453125)">
      <text y="-10.1" style=""><tspan x="0">internal module</tspan></text>
    </g>
  </g>
</svg>`;

    const result = inlineEdgeStyles(svg);
    expect(result).toContain('<text y="-10.1" style="text-anchor:middle;">');
  });

  it('injects text-anchor:middle into cluster label text', () => {
    const svg = `<svg>
  <style>#id .cluster-label text{fill:#333;text-anchor:middle;}</style>
  <g class="cluster-label">
    <g>
      <text y="-10.1" style=""><tspan x="0">plugins</tspan></text>
    </g>
  </g>
</svg>`;

    const result = inlineEdgeStyles(svg);
    expect(result).toContain('<text y="-10.1" style="text-anchor:middle;">');
  });

  it('does not duplicate text-anchor when already present inline', () => {
    const svg = `<svg>
  <style>#id .node .label text{text-anchor:middle;}</style>
  <g class="node default">
    <g class="label">
      <text y="-10.1" style="text-anchor:middle;"><tspan x="0">core</tspan></text>
    </g>
  </g>
</svg>`;

    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
    expect((result.match(/text-anchor:middle/g) ?? []).length).toBe(2);
  });
});
