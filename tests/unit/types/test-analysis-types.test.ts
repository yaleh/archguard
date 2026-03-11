import { describe, it, expect } from 'vitest';
import { TEST_ANALYSIS_VERSION } from '@/types/index.js';
import type { ArchJSONExtensions, TestAnalysis, TestFileInfo, TestIssue, TestPatternConfig } from '@/types/extensions.js';
import type { ILanguagePlugin } from '@/core/interfaces/language-plugin.js';

describe('TEST_ANALYSIS_VERSION', () => {
  it('equals "1.0"', () => {
    expect(TEST_ANALYSIS_VERSION).toBe('1.0');
  });
});

describe('ArchJSONExtensions', () => {
  it('accepts testAnalysis slot as optional', () => {
    const ext: ArchJSONExtensions = {};
    const ext2: ArchJSONExtensions = { testAnalysis: undefined };
    expect(ext).toBeDefined();
    expect(ext2).toBeDefined();
  });
});

describe('TestFileInfo', () => {
  it('testType union includes "debug"', () => {
    const t: TestFileInfo['testType'] = 'debug';
    expect(t).toBe('debug');
  });
  it('testType union includes all 6 values', () => {
    const types: Array<TestFileInfo['testType']> = ['unit', 'integration', 'e2e', 'performance', 'debug', 'unknown'];
    expect(types).toHaveLength(6);
  });
});

describe('TestIssue', () => {
  it('type union covers all four issue types', () => {
    const types: Array<TestIssue['type']> = ['zero_assertion', 'orphan_test', 'skip_accumulation', 'assertion_poverty'];
    expect(types).toHaveLength(4);
  });
});

describe('TestPatternConfig', () => {
  it('can be empty object', () => {
    const cfg: TestPatternConfig = {};
    expect(cfg).toBeDefined();
  });
});

describe('@/core alias', () => {
  it('ILanguagePlugin is importable via @/core alias', () => {
    const _: ILanguagePlugin | undefined = undefined;
    expect(true).toBe(true);
  });
});
