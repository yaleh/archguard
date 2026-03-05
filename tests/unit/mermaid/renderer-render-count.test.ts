/**
 * Spy tests verifying mermaid.render is called exactly once per diagram output.
 * Isolated from renderer.test.ts to avoid sharp mock interference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { IsomorphicMermaidRenderer } from '../../../src/mermaid/renderer.js';

// Top-level mock — hoisted by Vitest; keeps sharp out of this test module
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    flatten: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('IsomorphicMermaidRenderer – render call count', () => {
  let renderSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const mermaidModule = await import('isomorphic-mermaid');
    renderSpy = vi.spyOn(mermaidModule.default, 'render').mockResolvedValue({
      svg: '<svg viewBox="0 0 100 100"/>',
    } as any);
  });

  afterEach(() => {
    renderSpy.mockRestore();
  });

  it('renderAndSave calls mermaid.render exactly once (not twice)', async () => {
    const renderer = new IsomorphicMermaidRenderer();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renderer-spy-'));
    try {
      const paths = {
        mmd: path.join(tmpDir, 'out.mmd'),
        svg: path.join(tmpDir, 'out.svg'),
        png: path.join(tmpDir, 'out.png'),
      };
      await renderer.renderAndSave('flowchart LR\n  A --> B', paths);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('renderPNG calls mermaid.render exactly once (non-regression)', async () => {
    const renderer = new IsomorphicMermaidRenderer();
    const tmpFile = path.join(os.tmpdir(), `renderer-spy-${Date.now()}.png`);
    try {
      await renderer.renderPNG('flowchart LR\n  A --> B', tmpFile);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.remove(tmpFile).catch(() => {});
    }
  });
});
