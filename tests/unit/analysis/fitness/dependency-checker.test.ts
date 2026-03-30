import { describe, it, expect } from 'vitest';
import { checkDependencyConstraint } from '@/analysis/fitness/dependency-checker.js';
import type { DependencyConstraintRule } from '@/analysis/fitness/rule-types.js';
import type { Relation } from '@/types/index.js';

function makeRule(from: string, to: string): DependencyConstraintRule {
  return { type: 'no-dependency', from, to, message: `No dependency from ${from} to ${to}` };
}

function makeRelation(source: string, target: string): Relation {
  return { id: `${source}->${target}`, type: 'dependency', source, target };
}

describe('checkDependencyConstraint', () => {
  it('test 1: no relations → passed=true', () => {
    const rule = makeRule('src/parser/**', 'src/cli/**');
    const result = checkDependencyConstraint(rule, []);
    expect(result.passed).toBe(true);
  });

  it('test 2: relation src/parser/foo.ts → src/cli/bar.ts, rule parser→cli → passed=false', () => {
    const rule = makeRule('src/parser/**', 'src/cli/**');
    const relations = [makeRelation('src/parser/foo.ts', 'src/cli/bar.ts')];
    const result = checkDependencyConstraint(rule, relations);
    expect(result.passed).toBe(false);
  });

  it('test 3: relation within allowed boundary (src/parser → src/utils), rule parser→cli → passed=true', () => {
    const rule = makeRule('src/parser/**', 'src/cli/**');
    const relations = [makeRelation('src/parser/ast.ts', 'src/utils/helpers.ts')];
    const result = checkDependencyConstraint(rule, relations);
    expect(result.passed).toBe(true);
  });

  it('test 4: nested paths caught by rule: src/parser/deep/nested/file.ts → src/cli/commands/analyze.ts', () => {
    const rule = makeRule('src/parser/**', 'src/cli/**');
    const relations = [makeRelation('src/parser/deep/nested/file.ts', 'src/cli/commands/analyze.ts')];
    const result = checkDependencyConstraint(rule, relations);
    expect(result.passed).toBe(false);
  });

  it('test 5: multiple violating relations → detail mentions first one', () => {
    const rule = makeRule('src/parser/**', 'src/cli/**');
    const relations = [
      makeRelation('src/parser/foo.ts', 'src/cli/bar.ts'),
      makeRelation('src/parser/baz.ts', 'src/cli/qux.ts'),
    ];
    const result = checkDependencyConstraint(rule, relations);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('src/parser/foo.ts');
  });
});
