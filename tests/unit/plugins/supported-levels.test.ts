/**
 * TDD: supportedLevels field on each ILanguagePlugin implementation
 */

import { describe, it, expect } from 'vitest';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import { GoAtlasPlugin } from '@/plugins/golang/atlas/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { PythonPlugin } from '@/plugins/python/index.js';

describe('ILanguagePlugin.supportedLevels', () => {
  it('TypeScriptPlugin has supportedLevels ["package", "class", "method"]', () => {
    const plugin = new TypeScriptPlugin();
    expect(plugin.supportedLevels).toEqual(['package', 'class', 'method']);
  });

  it('GoPlugin has supportedLevels ["package", "capability", "goroutine", "flow"]', () => {
    const plugin = new GoPlugin(nativeParserBackend);
    expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
  });

  it('GoAtlasPlugin (shim alias for GoPlugin) has supportedLevels ["package", "capability", "goroutine", "flow"]', () => {
    const plugin = new GoAtlasPlugin(nativeParserBackend);
    expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
  });

  it('JavaPlugin has supportedLevels ["package", "class", "method"]', () => {
    const plugin = new JavaPlugin(nativeParserBackend);
    expect(plugin.supportedLevels).toEqual(['package', 'class', 'method']);
  });

  it('PythonPlugin has supportedLevels ["package", "class", "method"]', () => {
    const plugin = new PythonPlugin(nativeParserBackend);
    expect(plugin.supportedLevels).toEqual(['package', 'class', 'method']);
  });

  it('supportedLevels is a readonly array on each plugin', () => {
    const plugins = [
      new TypeScriptPlugin(),
      new GoPlugin(nativeParserBackend),
      new GoAtlasPlugin(nativeParserBackend),
      new JavaPlugin(nativeParserBackend),
      new PythonPlugin(nativeParserBackend),
    ];

    for (const plugin of plugins) {
      expect(Array.isArray(plugin.supportedLevels)).toBe(true);
      expect(plugin.supportedLevels.length).toBeGreaterThan(0);
    }
  });
});
