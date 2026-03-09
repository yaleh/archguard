/**
 * Unit tests for post-process-svg module
 * Tests postProcessSVG and inlineEdgeStyles exported from @/mermaid/post-process-svg.js
 */

import { describe, it, expect } from 'vitest';
import { inlineEdgeStyles, postProcessSVG } from '@/mermaid/post-process-svg.js';

const SIMPLE_SVG_NO_STYLE = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g></g></svg>`;
const SIMPLE_SVG_WITH_STYLE = `<svg xmlns="http://www.w3.org/2000/svg" style="color: red;" width="100" height="100"><g></g></svg>`;

describe('postProcessSVG', () => {
  describe('transparentBackground = false (background injection)', () => {
    it('Case A: SVG with no style attr gets background-color:white added', () => {
      const result = postProcessSVG(SIMPLE_SVG_NO_STYLE, false);
      expect(result).toContain('style="background-color: white;"');
      expect(result).toMatch(/<svg[^>]*style="background-color: white;"/);
    });

    it('Case B: SVG with existing style attr gets background-color appended', () => {
      const result = postProcessSVG(SIMPLE_SVG_WITH_STYLE, false);
      expect(result).toContain('background-color: white');
      // Original style value must still be present
      expect(result).toContain('color: red');
      // background-color should be appended, not replacing the existing style
      expect(result).toMatch(/<svg[^>]*style="color: red;[^"]*background-color: white;"/);
    });

    it('does not add background-color twice if already present', () => {
      const svgWithBg = `<svg style="background-color: white;"><g></g></svg>`;
      const result = postProcessSVG(svgWithBg, false);
      // Should only have one background-color occurrence in style
      const matches = result.match(/background-color/g) ?? [];
      expect(matches.length).toBe(1);
    });
  });

  describe('transparentBackground = true (no background injection)', () => {
    it('does NOT inject background-color when transparent is true', () => {
      const result = postProcessSVG(SIMPLE_SVG_NO_STYLE, true);
      expect(result).not.toContain('background-color');
    });

    it('still runs inlineEdgeStyles (fills are patched)', () => {
      const svgWithLink = `<svg><path class="flowchart-link" style=";" d="M0,0 L100,100"></path></svg>`;
      const result = postProcessSVG(svgWithLink, true);
      expect(result).toContain('fill:none');
    });

    it('does not add style attr when transparent and SVG has no style', () => {
      const result = postProcessSVG(SIMPLE_SVG_NO_STYLE, true);
      // The original has no style attribute; it should remain without one (or unchanged)
      expect(result).not.toMatch(/<svg[^>]*style="background-color/);
    });
  });

  describe('idempotency', () => {
    it('calling postProcessSVG twice yields the same result (non-transparent)', () => {
      const first = postProcessSVG(SIMPLE_SVG_NO_STYLE, false);
      const second = postProcessSVG(first, false);
      expect(second).toBe(first);
    });

    it('calling postProcessSVG twice yields the same result (transparent)', () => {
      const svgWithLink = `<svg><path class="flowchart-link" style=";" d="M0,0 L100,100"></path></svg>`;
      const first = postProcessSVG(svgWithLink, true);
      const second = postProcessSVG(first, true);
      expect(second).toBe(first);
    });
  });
});

describe('inlineEdgeStyles (re-exported from post-process-svg)', () => {
  it('is exported as a function', () => {
    expect(typeof inlineEdgeStyles).toBe('function');
  });

  it('smoke test: processes SVG string and returns a string', () => {
    const result = inlineEdgeStyles(SIMPLE_SVG_NO_STYLE);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('fixes flowchart-link fill (core behavior)', () => {
    const svg = `<path class="flowchart-link" style=";"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="fill:none;"');
  });

  it('preserves existing style values when patching flowchart-link', () => {
    const svg = `<path class="flowchart-link" style="stroke-width:2;"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toContain('style="stroke-width:2;fill:none;"');
  });

  it('does not modify paths without flowchart-link class', () => {
    const svg = `<path class="other-class" style="stroke-width:2;"></path>`;
    const result = inlineEdgeStyles(svg);
    expect(result).toBe(svg);
  });
});
