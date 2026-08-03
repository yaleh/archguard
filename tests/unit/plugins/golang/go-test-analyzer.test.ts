/**
 * Unit tests for GoTestAnalyzer.
 */

import { describe, it, expect } from 'vitest';
import { GoTestAnalyzer } from '@/plugins/golang/go-test-analyzer.js';

describe('GoTestAnalyzer', () => {
  describe('isTestFile', () => {
    it('detects _test.go files', () => {
      const analyzer = new GoTestAnalyzer();
      expect(analyzer.isTestFile('pkg/foo_test.go')).toBe(true);
      expect(analyzer.isTestFile('pkg/foo.go')).toBe(false);
    });

    it('uses patternConfig.testFileGlobs when provided', () => {
      const analyzer = new GoTestAnalyzer();
      expect(analyzer.isTestFile('pkg/integration/foo_test.go', { testFileGlobs: ['**/integration/**'] })).toBe(true);
      expect(analyzer.isTestFile('pkg/unit/foo_test.go', { testFileGlobs: ['**/integration/**'] })).toBe(true); // still endsWith _test.go
    });
  });

  describe('extractTestStructure', () => {
    it('returns null for non-test files', () => {
      expect(new GoTestAnalyzer().extractTestStructure('pkg/foo.go', 'package pkg')).toBeNull();
    });

    it('extracts testify framework and test cases', () => {
      const code = [
        'package pkg',
        '',
        'import (',
        '  "testing"',
        '  "github.com/stretchr/testify/assert"',
        ')',
        '',
        'func TestAdd(t *testing.T) {',
        '  assert.Equal(t, 3, Add(1, 2))',
        '  assert.True(t, true)',
        '}',
        '',
        'func TestSub(t *testing.T) {',
        '  t.Error("oops")',
        '}',
      ].join('\n');
      const result = new GoTestAnalyzer().extractTestStructure('pkg/calc_test.go', code);
      expect(result).not.toBeNull();
      expect(result!.frameworks).toContain('testify');
      expect(result!.testTypeHint).toBe('unit');
      expect(result!.testCases).toHaveLength(2);
      // assertionCount is computed over the whole file (assert.Equal, assert.True, t.Error)
      expect(result!.testCases[0].assertionCount).toBe(3);
      expect(result!.testCases[1].assertionCount).toBe(3);
    });

    it('detects skipped tests', () => {
      const code = [
        'package pkg',
        'import "testing"',
        'func TestSkip(t *testing.T) {',
        '  t.Skip("not ready")',
        '}',
      ].join('\n');
      const result = new GoTestAnalyzer().extractTestStructure('pkg/skip_test.go', code);
      expect(result!.testCases[0].isSkipped).toBe(true);
    });

    it('detects benchmarks and zeroes their assertion count', () => {
      const code = [
        'package pkg',
        'import "testing"',
        'func BenchmarkAdd(b *testing.B) {',
        '  for i := 0; i < b.N; i++ { Add(1, 2) }',
        '}',
      ].join('\n');
      const result = new GoTestAnalyzer().extractTestStructure('pkg/bench_test.go', code);
      expect(result!.testTypeHint).toBe('performance');
      expect(result!.testCases[0].assertionCount).toBe(0);
    });

    it('returns null when there are no test functions', () => {
      const code = 'package pkg\nimport "testing"\nfunc helper() {}';
      expect(new GoTestAnalyzer().extractTestStructure('pkg/empty_test.go', code)).toBeNull();
    });

    it('tracks imported source files within the module', () => {
      const code = [
        'package pkg',
        'import (',
        '  "testing"',
        '  "github.com/myorg/mymod/internal/calc"',
        '  "github.com/stretchr/testify/assert"',
        ')',
        'func TestX(t *testing.T) { assert.True(t, true) }',
      ].join('\n');
      const analyzer = new GoTestAnalyzer('github.com/myorg/mymod');
      const result = analyzer.extractTestStructure('pkg/x_test.go', code);
      expect(result!.importedSourceFiles).toContain('internal/calc');
    });

    it('handles invalid custom assertion regexes gracefully', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = [
        'package pkg',
        'import "testing"',
        'func TestX(t *testing.T) {}',
      ].join('\n');
      const analyzer = new GoTestAnalyzer();
      const result = analyzer.extractTestStructure('pkg/x_test.go', code, {
        customAssertionRegexes: ['[invalid', '\\bassert\\b'],
      });
      expect(result).not.toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('updateModuleName', () => {
    it('updates the cached module name', () => {
      const analyzer = new GoTestAnalyzer('old');
      analyzer.updateModuleName('new/module');
      const code = [
        'package pkg',
        'import (',
        '  "testing"',
        '  "new/module/foo"',
        ')',
        'func TestX(t *testing.T) {}',
      ].join('\n');
      const result = analyzer.extractTestStructure('pkg/x_test.go', code);
      expect(result!.importedSourceFiles).toContain('foo');
    });
  });
});
