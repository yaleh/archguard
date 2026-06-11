/**
 * Prompt templates for A/B task classes (Stage 63.1, proposal §6).
 *
 * Templates only ever interpolate OBFUSCATED names supplied by the
 * instantiator (which reads the obfuscated-tree ground truth). They contain
 * no ArchGuard / Mermaid domain vocabulary, and they pin down the JSON
 * answer format that score.ts parses (Stage 63.3).
 */
import type { AnswerType, TaskClass, TaskType } from './schema';

export const ANSWER_FORMAT_SET =
  'Respond with JSON only, exactly in this shape: {"answer": ["name1", "name2"]}. ' +
  'Use an empty array if nothing qualifies. No prose, no markdown fences.';

export const ANSWER_FORMAT_EXACT =
  'Respond with JSON only, exactly in this shape: {"answer": "name"}. ' +
  'No prose, no markdown fences.';

export interface TaskTemplate {
  taskType: TaskType;
  taskClass: TaskClass;
  answerType: AnswerType;
  /** Render the question text from obfuscated-name parameters. */
  render(params: Record<string, string>): string;
}

function need(params: Record<string, string>, key: string): string {
  const v = params[key];
  if (!v) throw new Error(`template parameter '${key}' is required`);
  return v;
}

export const TEMPLATES: Record<TaskType, TaskTemplate> = {
  'highest-in-degree': {
    taskType: 'highest-in-degree',
    taskClass: 'A',
    answerType: 'exact',
    render: () =>
      'Based only on the representation above: which entity has the highest number of ' +
      `incoming dependencies (in-degree)? ${ANSWER_FORMAT_EXACT}`,
  },
  'inter-layer-deps': {
    taskType: 'inter-layer-deps',
    taskClass: 'A',
    answerType: 'set',
    render: (p) =>
      `Based only on the representation above: which entities in package ${need(p, 'fromPackage')} ` +
      `directly depend on at least one entity in package ${need(p, 'toPackage')}? ${ANSWER_FORMAT_SET}`,
  },
  cycles: {
    taskType: 'cycles',
    taskClass: 'A',
    answerType: 'set',
    render: () =>
      'Based only on the representation above: list every entity that participates in at ' +
      `least one circular dependency. ${ANSWER_FORMAT_SET}`,
  },
  'articulation-point': {
    taskType: 'articulation-point',
    taskClass: 'A',
    answerType: 'set',
    render: () =>
      'Based only on the representation above: list every entity that is an articulation ' +
      'point of the dependency graph (removing it disconnects the graph). ' +
      ANSWER_FORMAT_SET,
  },
  'signature-change-impact': {
    taskType: 'signature-change-impact',
    taskClass: 'B',
    answerType: 'set',
    render: (p) =>
      `Based only on the representation above: if the signature of method ${need(p, 'method')} ` +
      `changes, which methods are directly impacted (they call it directly)? ${ANSWER_FORMAT_SET}`,
  },
  'callers-into': {
    taskType: 'callers-into',
    taskClass: 'B',
    answerType: 'set',
    render: (p) =>
      `Based only on the representation above: which methods call into ${need(p, 'target')} ` +
      `(i.e. call any method of ${need(p, 'target')})? ${ANSWER_FORMAT_SET}`,
  },
  'most-called-method': {
    taskType: 'most-called-method',
    taskClass: 'B',
    answerType: 'exact',
    render: () =>
      'Based only on the representation above: which method is called by the largest number ' +
      `of distinct other methods? ${ANSWER_FORMAT_EXACT}`,
  },
};
