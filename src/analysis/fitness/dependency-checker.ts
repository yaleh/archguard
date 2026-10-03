import micromatch from 'micromatch';
import type { DependencyConstraintRule, RuleResult } from './rule-types.js';
import type { Relation } from '@/types/index.js';

export function checkDependencyConstraint(
  rule: DependencyConstraintRule,
  relations: readonly Relation[] | null
): RuleResult {
  // `null` = the relation graph itself is unavailable (no analyze artifact, or
  // no edges at this granularity). That is not a pass — report it as
  // not-evaluated so callers cannot mistake "couldn't check" for "checked, clean".
  if (relations === null) {
    return {
      rule,
      passed: false,
      evaluated: false,
      detail: 'no relation data available (run `archguard analyze` to produce it)',
    };
  }

  for (const relation of relations) {
    const sourceMatches = micromatch.isMatch(relation.source, rule.from);
    const targetMatches = micromatch.isMatch(relation.target, rule.to);
    if (sourceMatches && targetMatches) {
      return {
        rule,
        passed: false,
        detail: `Forbidden dependency: ${relation.source} → ${relation.target}`,
      };
    }
  }
  return { rule, passed: true };
}
