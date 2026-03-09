/**
 * Isolated tests for convertSVGToPNG that verify the method does NOT call
 * inlineEdgeStyles internally. The caller is responsible for pre-processing
 * (postProcessSVG) before handing an SVG to convertSVGToPNG.
 *
 * Isolated from renderer.test.ts to allow top-level vi.mock hoisting without
 * interfering with the real-sharp tests in that file.
 */
import { describe, it, expect, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { IsomorphicMermaidRenderer } from '../../../src/mermaid/renderer.js';

// Top-level mocks — hoisted by Vitest before any imports resolve.
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    flatten: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/mermaid/post-process-svg.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/mermaid/post-process-svg.js')>();
  return {
    ...original,
    inlineEdgeStyles: vi.fn(original.inlineEdgeStyles),
  };
});

describe('convertSVGToPNG', () => {
  it('does not call inlineEdgeStyles internally — caller is responsible for pre-processing', async () => {
    const { inlineEdgeStyles } = await import('@/mermaid/post-process-svg.js');
    const spy = inlineEdgeStyles as ReturnType<typeof vi.fn>;
    spy.mockClear();

    const renderer = new IsomorphicMermaidRenderer();
    const tmpPath = path.join(os.tmpdir(), `convert-svg-test-${Date.now()}.png`);
    const simpleSvg = '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';

    try {
      await renderer.convertSVGToPNG(simpleSvg, tmpPath);
    } finally {
      await fs.remove(tmpPath).catch(() => {});
    }

    expect(spy).toHaveBeenCalledTimes(0);
  });
});
