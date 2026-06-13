import micromatch from 'micromatch';
import type { RawTestFile, RawTestCase } from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';

function compileCustomAssertionRegexes(patterns?: string[]): RegExp[] {
  return (patterns ?? []).flatMap((pattern) => {
    try {
      return [new RegExp(pattern)];
    } catch (error) {
      console.warn(
        `[go:test-analysis] Invalid custom assertion regex "${pattern}": ${String(error)}`
      );
      return [];
    }
  });
}

export class GoTestAnalyzer {
  constructor(private cachedModuleName: string = '') {}

  updateModuleName(moduleName: string): void {
    this.cachedModuleName = moduleName;
  }

  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    return (
      filePath.endsWith('_test.go') ||
      (patternConfig?.testFileGlobs?.length
        ? micromatch.isMatch(filePath, patternConfig.testFileGlobs)
        : false)
    );
  }

  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath, patternConfig)) return null;

    const frameworks: string[] = [];
    const importBlock = code.match(/import\s*\(([^)]*)\)/s)?.[1] ?? '';
    if (/testify\/assert|testify\/require/.test(importBlock)) frameworks.push('testify');
    if (/testing\/quick/.test(importBlock)) frameworks.push('testing/quick');
    if (!frameworks.includes('testify')) frameworks.push('testing');

    const fnRegex = /^func\s+(Test\w*|Benchmark\w*|Example\w*|Fuzz\w*)\s*\(/gm;
    const testCases: RawTestCase[] = [];
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(code)) !== null) {
      const name = match[1];
      const isSkipped = new RegExp(`func\\s+${name}[^{]*\\{[^}]*t\\.Skip`, 's').test(code);
      const isBenchmark = name.startsWith('Benchmark');

      const assertPatterns = [
        /\bassert\.\w+\s*\(/g,
        /\brequire\.\w+\s*\(/g,
        /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/g,
      ];
      const customAssertionRegexes = compileCustomAssertionRegexes(
        patternConfig?.customAssertionRegexes
      );
      let assertionCount = 0;
      for (const pat of assertPatterns) {
        const all = code.match(pat);
        if (all) assertionCount += all.length;
      }
      if (customAssertionRegexes.length > 0) {
        for (const line of code.split('\n')) {
          assertionCount += customAssertionRegexes.filter((regex) => regex.test(line)).length;
        }
      }

      testCases.push({ name, assertionCount: isBenchmark ? 0 : assertionCount, isSkipped });
    }

    if (testCases.length === 0) return null;

    const importedSourceFiles: string[] = [];
    const importLineRegex = /^\s*(?:\w+\s+)?"([^"]+)"/gm;
    while ((match = importLineRegex.exec(importBlock)) !== null) {
      const pkg = match[1];
      if (this.cachedModuleName && pkg.startsWith(this.cachedModuleName + '/')) {
        importedSourceFiles.push(pkg.slice(this.cachedModuleName.length + 1));
        continue;
      }
      if (!pkg.includes('/') || pkg.startsWith('github.com/') || pkg.startsWith('golang.org/')) {
        continue;
      }
      importedSourceFiles.push(pkg);
    }

    const hasBenchmark = /^func\s+Benchmark\w*\s*\(/m.test(code);
    const testTypeHint: RawTestFile['testTypeHint'] = hasBenchmark ? 'performance' : 'unit';

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles,
    };
  }
}
