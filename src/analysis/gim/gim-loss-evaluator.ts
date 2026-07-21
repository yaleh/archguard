import type { GimLossRule } from '@/analysis/fitness/rule-types.js';
import type { RuleResult } from '@/analysis/fitness/rule-types.js';
import type { MetricVector } from '@/types/metric-vector.js';

export interface LossStatus {
  value: number;
  status: 'healthy' | 'warning' | 'info';
  detail: string;
  proxy: true;
}

type LossName = GimLossRule['loss'];

function resolveProxy(loss: LossName, vector: MetricVector): number | null {
  switch (loss) {
    case 'feasibility':
      return vector.sccCount;
    case 'consistency':
      return vector.inferredRelationRatio;
    case 'description-length':
      return vector.totalEntities + vector.totalRelations;
    case 'generation-alignment':
      return vector.giniInDegree;
    default:
      return null;
  }
}

function compare(actual: number, op: GimLossRule['op'], threshold: number): boolean {
  switch (op) {
    case '<': return actual < threshold;
    case '<=': return actual <= threshold;
    case '>': return actual > threshold;
    case '>=': return actual >= threshold;
    case '==': return actual === threshold;
    case '!=': return actual !== threshold;
  }
}

const PROXY_LABELS: Record<LossName, string> = {
  feasibility: 'sccCount (proxy for ℒ_F)',
  consistency: 'inferredRelationRatio (proxy for ℒ_C)',
  'description-length': 'totalEntities + totalRelations (proxy for ℒ_D)',
  'generation-alignment': 'giniInDegree (proxy for ℒ_A)',
};

export function evaluateGimLossRule(rule: GimLossRule, vector: MetricVector): RuleResult {
  const proxyValue = resolveProxy(rule.loss, vector);
  if (proxyValue === null) {
    return {
      rule,
      passed: false,
      detail: `Unknown GIM loss type: '${rule.loss}'`,
    };
  }

  const passed = compare(proxyValue, rule.op, rule.value);
  return {
    rule,
    passed,
    actual: proxyValue,
    detail: `${PROXY_LABELS[rule.loss]} = ${proxyValue}`,
  };
}

export function computeAllLosses(vector: MetricVector): Record<LossName, LossStatus> {
  const feasibilityVal = vector.sccCount;
  const consistencyVal = vector.inferredRelationRatio;
  const descLengthVal = vector.totalEntities + vector.totalRelations;
  const alignmentVal = vector.giniInDegree;

  return {
    feasibility: {
      value: feasibilityVal,
      status: feasibilityVal === 0 ? 'healthy' : 'warning',
      detail: `sccCount=${feasibilityVal}. Proxy for structural feasibility loss ℒ_F. Zero cycles = minimum feasibility loss.`,
      proxy: true,
    },
    consistency: {
      value: consistencyVal,
      status: consistencyVal <= 0.3 ? 'healthy' : 'warning',
      detail: `inferredRelationRatio=${consistencyVal.toFixed(3)}. Proxy for consistency loss ℒ_C. High ratio = many unresolved type dependencies.`,
      proxy: true,
    },
    'description-length': {
      value: descLengthVal,
      status: 'info',
      detail: `totalEntities(${vector.totalEntities}) + totalRelations(${vector.totalRelations}) = ${descLengthVal}. Proxy for description-length loss ℒ_D. Smaller = easier to describe.`,
      proxy: true,
    },
    'generation-alignment': {
      value: alignmentVal,
      status: alignmentVal <= 0.5 ? 'healthy' : 'warning',
      detail: `giniInDegree=${alignmentVal.toFixed(3)}. Proxy for generation-alignment loss ℒ_A. High gini = few nodes dominate dependency graph.`,
      proxy: true,
    },
  };
}
