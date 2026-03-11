import { describe, it, expect } from 'vitest';
import { TestCoverageRenderer } from '@/mermaid/test-coverage-renderer.js';
import type { TestAnalysis } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

function makeAnalysis(overrides: Partial<TestAnalysis> = {}): TestAnalysis {
  return {
    version: '1.0',
    patternConfigSource: 'auto',
    testFiles: [],
    coverageMap: [],
    issues: [],
    metrics: {
      totalTestFiles: 0,
      byType: { unit: 0, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
      entityCoverageRatio: 0,
      assertionDensity: 0,
      skipRatio: 0,
      issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
    },
    ...overrides,
  };
}

function makeArchJson(entities: any[] = []): ArchJSON {
  return { version: '1.0', language: 'typescript', entities, relations: [], extensions: {} } as any;
}

describe('TestCoverageRenderer', () => {
  it('generates a valid Mermaid graph TD diagram', () => {
    const renderer = new TestCoverageRenderer();
    const result = renderer.render(makeAnalysis(), makeArchJson());
    expect(result).toContain('graph TD');
  });

  it('places entity with score >= 0.7 in "Well Tested" bucket', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      coverageMap: [{ sourceEntityId: 'entity-1', coveredByTestIds: ['foo.test.ts'], coverageScore: 0.85 }],
    });
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'FooService', type: 'class', sourceLocation: { file: 'src/foo.ts' } },
    ]);
    const result = renderer.render(analysis, archJson);
    expect(result).toContain('Well Tested');
    expect(result).toContain('FooService');
  });

  it('places entity with score 0.3-0.7 in "Partially Tested" bucket', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      coverageMap: [{ sourceEntityId: 'entity-1', coveredByTestIds: ['foo.test.ts'], coverageScore: 0.5 }],
    });
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'BarService', type: 'class', sourceLocation: { file: 'src/bar.ts' } },
    ]);
    const result = renderer.render(analysis, archJson);
    expect(result).toContain('Partially Tested');
    expect(result).toContain('BarService');
  });

  it('places entity with score < 0.3 in "Not Tested" bucket', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({ coverageMap: [] });
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'BazService', type: 'class', sourceLocation: { file: 'src/baz.ts' } },
    ]);
    const result = renderer.render(analysis, archJson);
    expect(result).toContain('Not Tested');
    expect(result).toContain('BazService');
  });

  it('shows "Debug Only" bucket when debug test files exist', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      testFiles: [{
        id: 'debug.test.ts',
        filePath: '/workspace/debug.test.ts',
        frameworks: ['vitest'],
        testType: 'debug',
        testCaseCount: 1,
        assertionCount: 0,
        skipCount: 0,
        assertionDensity: 0,
        coveredEntityIds: [],
      }],
    });
    const result = renderer.render(analysis, makeArchJson());
    expect(result).toContain('Debug Only');
    expect(result).toContain('debug.test.ts');
  });

  it('truncates oversized buckets with "+N more" label', () => {
    const renderer = new TestCoverageRenderer();
    // Create 25 entities all with score 0 (Not Tested) — bucket limit is 20
    const entities = Array.from({ length: 25 }, (_, i) => ({
      id: `entity-${i}`,
      name: `Service${i}`,
      type: 'class',
      sourceLocation: { file: `src/service${i}.ts` },
    }));
    const result = renderer.render(makeAnalysis({ coverageMap: [] }), makeArchJson(entities));
    expect(result).toContain('+5 more');
  });

  it('only includes class and interface entities', () => {
    const renderer = new TestCoverageRenderer();
    const archJson = makeArchJson([
      { id: 'e1', name: 'MyClass', type: 'class', sourceLocation: { file: 'src/a.ts' } },
      { id: 'e2', name: 'myFunction', type: 'function', sourceLocation: { file: 'src/b.ts' } },
      { id: 'e3', name: 'MyInterface', type: 'interface', sourceLocation: { file: 'src/c.ts' } },
    ]);
    const result = renderer.render(makeAnalysis(), archJson);
    expect(result).toContain('MyClass');
    expect(result).not.toContain('myFunction');
    expect(result).toContain('MyInterface');
  });

  it('does not show Debug Only bucket when no debug test files exist', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      testFiles: [{
        id: 'normal.test.ts',
        filePath: '/workspace/normal.test.ts',
        frameworks: ['vitest'],
        testType: 'unit',
        testCaseCount: 5,
        assertionCount: 10,
        skipCount: 0,
        assertionDensity: 2,
        coveredEntityIds: [],
      }],
    });
    const result = renderer.render(analysis, makeArchJson());
    expect(result).not.toContain('Debug Only');
  });

  it('handles exact boundary score of 0.7 as "Well Tested"', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      coverageMap: [{ sourceEntityId: 'e1', coveredByTestIds: ['t.test.ts'], coverageScore: 0.7 }],
    });
    const archJson = makeArchJson([
      { id: 'e1', name: 'BoundaryService', type: 'class', sourceLocation: { file: 'src/x.ts' } },
    ]);
    const result = renderer.render(analysis, archJson);
    expect(result).toContain('Well Tested');
    expect(result).toContain('BoundaryService');
  });

  it('handles exact boundary score of 0.3 as "Partially Tested"', () => {
    const renderer = new TestCoverageRenderer();
    const analysis = makeAnalysis({
      coverageMap: [{ sourceEntityId: 'e1', coveredByTestIds: ['t.test.ts'], coverageScore: 0.3 }],
    });
    const archJson = makeArchJson([
      { id: 'e1', name: 'LowService', type: 'class', sourceLocation: { file: 'src/x.ts' } },
    ]);
    const result = renderer.render(analysis, archJson);
    expect(result).toContain('Partially Tested');
    expect(result).toContain('LowService');
  });

  it('truncates long entity names to 30 chars', () => {
    const renderer = new TestCoverageRenderer();
    const longName = 'AVeryLongServiceNameThatExceedsThirtyChars';
    const archJson = makeArchJson([
      { id: 'e1', name: longName, type: 'class', sourceLocation: { file: 'src/long.ts' } },
    ]);
    const result = renderer.render(makeAnalysis(), archJson);
    // Should not contain the full name
    expect(result).not.toContain(longName);
    // Should contain the truncated version: slice(0, 29) + ellipsis character
    expect(result).toContain('AVeryLongServiceNameThatExcee');
  });
});
