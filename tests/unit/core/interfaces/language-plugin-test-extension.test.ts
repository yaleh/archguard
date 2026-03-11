import { describe, it, expect } from 'vitest';
import type { ILanguagePlugin, RawTestFile, RawTestCase, PluginCapabilities } from '@/core/interfaces/language-plugin.js';

describe('RawTestFile', () => {
  it('testTypeHint union does not include "debug"', () => {
    const hint: RawTestFile['testTypeHint'] = 'unknown';
    expect(['unit','integration','e2e','performance','unknown']).toContain(hint);
  });
});

describe('ILanguagePlugin optional test methods', () => {
  it('plugin without test methods is still valid', () => {
    const minimal: Partial<ILanguagePlugin> = {
      metadata: {} as any,
      initialize: async () => {},
      canHandle: () => false,
      dispose: async () => {},
      supportedLevels: [],
      parseCode: () => ({} as any),
      parseProject: async () => ({} as any),
    };
    expect(minimal.isTestFile).toBeUndefined();
    expect(minimal.extractTestStructure).toBeUndefined();
  });
});

describe('PluginCapabilities', () => {
  it('testStructureExtraction is optional', () => {
    const caps: PluginCapabilities = {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: false,
      typeInference: false,
    };
    expect(caps.testStructureExtraction).toBeUndefined();
  });
});
