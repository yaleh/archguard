import micromatch from 'micromatch';
import type { DependencyConstraintRule, RuleResult } from './rule-types.js';
import type { Relation } from '@/types/index.js';

export function checkDependencyConstraint(
  rule: DependencyConstraintRule,
  relations: Relation[]
): RuleResult {
  for (const relation of relations) {
    const sourceMatches = micromatch.isMatch(relation.source, rule.from);
    const targetMatches = micromatch.isMatch(relation.target, rule.to);
    if (sourceMatches && targetMatches) {
      return {
        rule,
        passed: false,
        detail: `Forbidden dependency: ${relation.source} → ${relation.target}. ${rule.message}`,
      };
    }
  }
  return { rule, passed: true };
}
