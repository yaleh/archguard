/**
 * Task schema for the granularity experiment (Stage 63.1).
 *
 * Hand-written validation (no zod/ajv per plan discipline). A task is the
 * unit consumed by run-tasks.ts and score.ts; tasks.json is frozen at
 * Phase 64 (Stage 64.3) together with the protocol.
 */

export type TaskClass = 'A' | 'B';
export type AnswerType = 'set' | 'exact';
/** B-class ground-truth interpretation for interface dispatch (frozen in 64.1). */
export type GtVariant = 'interface-member' | 'expanded';

export const A_TASK_TYPES = [
  'highest-in-degree',
  'inter-layer-deps',
  'cycles',
  'articulation-point',
] as const;
export const B_TASK_TYPES = [
  'signature-change-impact',
  'callers-into',
  'most-called-method',
] as const;

export type ATaskType = (typeof A_TASK_TYPES)[number];
export type BTaskType = (typeof B_TASK_TYPES)[number];
export type TaskType = ATaskType | BTaskType;

export interface Task {
  /** Unique task id, e.g. "modA-highest-in-degree-1". */
  id: string;
  taskClass: TaskClass;
  /** Obfuscated module identifier the task is scoped to. */
  module: string;
  taskType: TaskType;
  /** Fully rendered prompt (must specify the JSON answer format). */
  prompt: string;
  /** Obfuscated entity names involved in question and/or answer. */
  entities: string[];
  /** 'set' is scored with F1, 'exact' with exact match (EM). */
  answerType: AnswerType;
  /** Gold answer: string[] for 'set'; string|number for 'exact'. */
  answer: string[] | string | number;
  /** Required for B-class tasks; must be absent on A-class tasks. */
  gtVariant?: GtVariant;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function validateTask(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, errors: ['task must be a plain object'] };
  }
  const t = value as Record<string, unknown>;

  if (!isNonEmptyString(t.id)) errors.push('id: non-empty string required');
  if (t.taskClass !== 'A' && t.taskClass !== 'B') errors.push("taskClass: must be 'A' or 'B'");
  if (!isNonEmptyString(t.module)) errors.push('module: non-empty string required');

  const aTypes: readonly string[] = A_TASK_TYPES;
  const bTypes: readonly string[] = B_TASK_TYPES;
  if (!isNonEmptyString(t.taskType) || (!aTypes.includes(t.taskType) && !bTypes.includes(t.taskType))) {
    errors.push(`taskType: must be one of ${[...aTypes, ...bTypes].join(', ')}`);
  } else if (t.taskClass === 'A' && !aTypes.includes(t.taskType)) {
    errors.push(`taskType: '${t.taskType}' is not an A-class task type`);
  } else if (t.taskClass === 'B' && !bTypes.includes(t.taskType)) {
    errors.push(`taskType: '${t.taskType}' is not a B-class task type`);
  }

  if (!isNonEmptyString(t.prompt)) {
    errors.push('prompt: non-empty string required');
  } else if (!t.prompt.includes('"answer"')) {
    errors.push('prompt: must specify the JSON answer format (missing "answer" key spec)');
  }

  if (!Array.isArray(t.entities) || !t.entities.every(isNonEmptyString)) {
    errors.push('entities: array of non-empty strings required');
  }

  if (t.answerType !== 'set' && t.answerType !== 'exact') {
    errors.push("answerType: must be 'set' or 'exact'");
  } else if (t.answerType === 'set') {
    if (!Array.isArray(t.answer) || !t.answer.every(isNonEmptyString)) {
      errors.push("answer: answerType 'set' requires an array of non-empty strings");
    }
  } else {
    if (!isNonEmptyString(t.answer) && typeof t.answer !== 'number') {
      errors.push("answer: answerType 'exact' requires a non-empty string or a number");
    }
  }

  if (t.taskClass === 'B') {
    if (t.gtVariant !== 'interface-member' && t.gtVariant !== 'expanded') {
      errors.push("gtVariant: B-class tasks require 'interface-member' or 'expanded'");
    }
  } else if (t.taskClass === 'A' && t.gtVariant !== undefined) {
    errors.push('gtVariant: must be absent on A-class tasks');
  }

  return { valid: errors.length === 0, errors };
}

export function validateTasks(value: unknown): ValidationResult {
  if (!Array.isArray(value)) return { valid: false, errors: ['tasks: must be an array'] };
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((task, i) => {
    const r = validateTask(task);
    errors.push(...r.errors.map((e) => `[${i}] ${e}`));
    const id = (task as Record<string, unknown> | null)?.id;
    if (typeof id === 'string') {
      if (seen.has(id)) errors.push(`[${i}] id: duplicate '${id}'`);
      seen.add(id);
    }
  });
  return { valid: errors.length === 0, errors };
}
