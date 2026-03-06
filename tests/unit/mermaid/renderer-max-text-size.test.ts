/**
 * Spy tests verifying mermaid.initialize is called with maxTextSize: 200000.
 * Isolated from renderer.test.ts to avoid sharp mock interference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('IsomorphicMermaidRenderer – mermaid.initialize config', () => {
  let initializeSpy: ReturnType<typeof vi.spyOn>;
  let renderSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const mermaidModule = await import('isomorphic-mermaid');
    initializeSpy = vi.spyOn(mermaidModule.default, 'initialize');
    renderSpy = vi.spyOn(mermaidModule.default, 'render').mockResolvedValue({
      svg: '<svg viewBox="0 0 100 100"/>',
    } as any);
  });

  afterEach(() => {
    initializeSpy.mockRestore();
    renderSpy.mockRestore();
  });

  it('calls mermaid.initialize with maxTextSize: 200000', async () => {
    const renderer = new IsomorphicMermaidRenderer();
    // Trigger initialization by calling renderSVG
    await renderer.renderSVG('classDiagram\n  class A');

    expect(initializeSpy).toHaveBeenCalledOnce();
    const config = initializeSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(config.maxTextSize).toBe(200000);
  });

  it('includes maxTextSize in config alongside standard options', async () => {
    const renderer = new IsomorphicMermaidRenderer({
      theme: { name: 'dark' },
    });
    await renderer.renderSVG('classDiagram\n  class B');

    const config = initializeSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(config.startOnLoad).toBe(false);
    expect(config.securityLevel).toBe('loose');
    expect(config.theme).toBe('dark');
    expect(config.maxTextSize).toBe(200000);
  });

  it('does not re-initialize mermaid on subsequent renders', async () => {
    const renderer = new IsomorphicMermaidRenderer();
    await renderer.renderSVG('classDiagram\n  class A');
    await renderer.renderSVG('classDiagram\n  class B');

    // initialize should only be called once regardless of how many renders happen
    expect(initializeSpy).toHaveBeenCalledOnce();
  });
});
