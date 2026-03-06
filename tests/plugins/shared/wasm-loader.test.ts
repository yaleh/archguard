import { describe, it, expect, beforeAll } from 'vitest';
import { initTreeSitter, loadLanguage } from '../../../src/plugins/shared/wasm-loader.js';

describe('wasm-loader', () => {
  beforeAll(async () => {
    await initTreeSitter();
  });

  it('initTreeSitter() resolves without error', async () => {
    // Second call should be idempotent (no-op)
    await expect(initTreeSitter()).resolves.toBeUndefined();
  });

  it('loadLanguage() loads tree-sitter-go WASM', async () => {
    const lang = await loadLanguage('tree-sitter-go', 'tree-sitter-go.wasm');
    expect(lang).toBeDefined();
    expect(typeof lang.abiVersion).toBe('number');
  });

  it('loadLanguage() loads tree-sitter-cpp WASM', async () => {
    const lang = await loadLanguage('tree-sitter-cpp', 'tree-sitter-cpp.wasm');
    expect(lang).toBeDefined();
  });

  it('loadLanguage() loads tree-sitter-java WASM', async () => {
    const lang = await loadLanguage('tree-sitter-java', 'tree-sitter-java.wasm');
    expect(lang).toBeDefined();
  });

  it('loadLanguage() loads tree-sitter-python WASM', async () => {
    const lang = await loadLanguage('tree-sitter-python', 'tree-sitter-python.wasm');
    expect(lang).toBeDefined();
  });

  it('loadLanguage() caches language instances', async () => {
    const lang1 = await loadLanguage('tree-sitter-go', 'tree-sitter-go.wasm');
    const lang2 = await loadLanguage('tree-sitter-go', 'tree-sitter-go.wasm');
    expect(lang1).toBe(lang2);
  });

  it('loaded language can parse Go code', async () => {
    const { Parser } = await import('web-tree-sitter');
    const lang = await loadLanguage('tree-sitter-go', 'tree-sitter-go.wasm');
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse('package main\nfunc main() {}');
    expect(tree.rootNode.type).toBe('source_file');
    expect(tree.rootNode.hasError).toBe(false);
  });
});
