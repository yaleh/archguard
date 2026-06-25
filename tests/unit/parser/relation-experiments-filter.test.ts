/**
 * Unit tests for experiment-path relation filtering in TypeScriptParser
 *
 * Phase 108-B: Ensure that relations whose source or target references
 * a path containing 'experiments/' are filtered out to eliminate
 * dangling-relation warnings during self-analysis.
 */

import { describe, it, expect } from 'vitest';
import type { Relation } from '@/types';

// Helper to extract filtered relations from TypeScriptParser
// We test the private filterExperimentRelations via the public interface
// by constructing ArchJSON and verifying the output after parseProject processing.

/**
 * Build a minimal ArchJSON with given relations and no entities,
 * then verify which relations survive experiment-path filtering.
 *
 * We call the filtering indirectly: TypeScriptParser.filterExternalRelations
 * is private, so we verify behaviour via the exported helper used in tests.
 */

// Direct unit test of the experiment-path filter logic
// (exposed via module-level helper for testability)
import { filterExperimentRelations } from '@/parser/typescript-parser';

describe('filterExperimentRelations — experiment-path filtering', () => {
  it('should keep normal src-to-src relations unchanged', () => {
    const relations: Relation[] = [
      {
        id: 'rel1',
        type: 'dependency',
        source: 'src/parser/typescript-parser.ts.TypeScriptParser',
        target: 'src/types/index.ts.ArchJSON',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('src/parser/typescript-parser.ts.TypeScriptParser');
  });

  it('should filter out relations whose source starts with experiments/', () => {
    const relations: Relation[] = [
      {
        id: 'rel-exp-src',
        type: 'dependency',
        source: 'experiments/granularity/analyze.ts.SomeClass',
        target: 'src/types/index.ts.ArchJSON',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(0);
  });

  it('should filter out relations whose target starts with experiments/', () => {
    const relations: Relation[] = [
      {
        id: 'rel-exp-tgt',
        type: 'dependency',
        source: 'src/parser/typescript-parser.ts.TypeScriptParser',
        target: 'experiments/granularity/lib.ts.Helper',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(0);
  });

  it('should filter out relations whose source contains /experiments/', () => {
    const relations: Relation[] = [
      {
        id: 'rel-exp-nested',
        type: 'dependency',
        source: 'some/path/experiments/sub/file.ts.SomeClass',
        target: 'src/types/index.ts.ArchJSON',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(0);
  });

  it('should filter out relations whose target contains /experiments/', () => {
    const relations: Relation[] = [
      {
        id: 'rel-exp-tgt-nested',
        type: 'inheritance',
        source: 'src/core/MyClass.ts.MyClass',
        target: 'some/path/experiments/sub/base.ts.BaseClass',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(0);
  });

  it('should handle empty relation list without crashing', () => {
    const result = filterExperimentRelations([]);
    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('should keep relations with "experiments" in an unrelated part of the name', () => {
    // e.g. a class named MyExperimentsRunner that is NOT in an experiments/ directory
    const relations: Relation[] = [
      {
        id: 'rel-safe',
        type: 'dependency',
        source: 'src/runner/experiments-runner.ts.ExperimentsRunner',
        target: 'src/types/index.ts.Config',
      },
    ];
    const result = filterExperimentRelations(relations);
    // "experiments-runner.ts" does NOT match path segment "experiments/"
    expect(result).toHaveLength(1);
  });

  it('should filter when only one of multiple relations is an experiment relation', () => {
    const relations: Relation[] = [
      {
        id: 'rel-keep',
        type: 'dependency',
        source: 'src/parser/typescript-parser.ts.TypeScriptParser',
        target: 'src/types/index.ts.ArchJSON',
      },
      {
        id: 'rel-drop',
        type: 'dependency',
        source: 'experiments/granularity/analyze.ts.Analyzer',
        target: 'src/types/index.ts.ArchJSON',
      },
    ];
    const result = filterExperimentRelations(relations);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rel-keep');
  });
});
