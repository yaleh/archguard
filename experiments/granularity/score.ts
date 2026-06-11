/**
 * Automatic scorer (Stage 63.3).
 *
 * - Set-type answers → F1; exact-type → exact match (EM).
 * - k=5 aggregation: majority vote for categorical exact answers (tie rule
 *   below), median for numeric exact answers, median-of-F1 for sets.
 * - Model answers must be the JSON format pinned in the prompt templates
 *   ({"answer": ...}); unparseable replies score 0 and are flagged
 *   parse_error.
 * - Output: long-table JSON rows keyed by (task × level × model) with the
 *   fields Phase 62 analyze.py consumes: taskId / taskClass / level / model /
 *   score / per-vote details.
 *
 * Tie rule (majority vote, frozen): the winner is the candidate with the
 * strictly highest vote count; when several candidates tie for the top
 * count, the lexicographically smallest tied candidate is chosen
 * deterministically and the row is flagged `tie: true`. The gold answer is
 * never consulted when breaking ties.
 *
 * Scoring operates on obfuscated names only; mapping.json is not read here
 * (it is used for reconciliation elsewhere, never for scoring).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { GT_DIR, RUNS_DIR } from './lib/paths';
import type { Level } from './run-tasks';
import type { Task } from './tasks/schema';

export type ParsedAnswer = string[] | string | number;

export interface VoteDetail {
  k: number;
  raw: string;
  parsed: ParsedAnswer | null;
  parseError: boolean;
  voteScore: number;
  invalidated: boolean;
}

export interface ScoreRow {
  taskId: string;
  taskClass: 'A' | 'B';
  level: Level;
  model: string;
  score: number;
  answerType: 'set' | 'exact';
  aggregation: 'median-f1' | 'majority-em' | 'median-em';
  parseErrorCount: number;
  parse_error: boolean;
  tie: boolean;
  /** Any vote came from a §13.6-invalidated batch → needs re-run. */
  needsRerun: boolean;
  votes: VoteDetail[];
}

// ---------------------------------------------------------------------------
// Answer parsing
// ---------------------------------------------------------------------------
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parse a model reply into {"answer": ...}; null on any deviation. */
export function parseModelAnswer(raw: string, answerType: 'set' | 'exact'): ParsedAnswer | null {
  const candidates: string[] = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const c of candidates) {
    const parsed = tryJson(c);
    if (typeof parsed !== 'object' || parsed === null || !('answer' in parsed)) continue;
    const answer = (parsed as { answer: unknown }).answer;
    if (answerType === 'set') {
      if (Array.isArray(answer) && answer.every((x) => typeof x === 'string' || typeof x === 'number')) {
        return answer.map(String);
      }
    } else if (typeof answer === 'string' || typeof answer === 'number') {
      return answer;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Primitive scores
// ---------------------------------------------------------------------------
/** Set F1 over deduplicated obfuscated names. Both empty → 1; one empty → 0. */
export function scoreSetF1(predicted: string[], gold: string[]): number {
  const p = new Set(predicted);
  const g = new Set(gold);
  if (g.size === 0 && p.size === 0) return 1;
  if (g.size === 0 || p.size === 0) return 0;
  let hits = 0;
  for (const x of p) if (g.has(x)) hits++;
  if (hits === 0) return 0;
  const precision = hits / p.size;
  const recall = hits / g.size;
  return (2 * precision * recall) / (precision + recall);
}

export function scoreExact(predicted: string | number, gold: string | number): number {
  return String(predicted) === String(gold) ? 1 : 0;
}

/** Majority vote. Tie → lexicographically smallest top candidate, flagged. */
export function majorityVote(values: Array<string | number>): {
  winner: string | null;
  tie: boolean;
} {
  if (values.length === 0) return { winner: null, tie: false };
  const counts = new Map<string, number>();
  for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const tied = [...counts.entries()]
    .filter(([, n]) => n === top)
    .map(([v]) => v)
    .sort();
  return { winner: tied[0] ?? null, tie: tied.length > 1 };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of empty list');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// k-vote aggregation per (task × level × model)
// ---------------------------------------------------------------------------
export interface RawVote {
  k: number;
  content: string;
  invalidated?: boolean;
}

export function aggregateVotes(
  task: Task,
  level: Level,
  model: string,
  rawVotes: RawVote[]
): ScoreRow {
  const votes: VoteDetail[] = [...rawVotes]
    .sort((a, b) => a.k - b.k)
    .map((v) => {
      const parsed = parseModelAnswer(v.content, task.answerType);
      let voteScore = 0;
      if (parsed !== null) {
        voteScore =
          task.answerType === 'set'
            ? scoreSetF1(parsed as string[], task.answer as string[])
            : scoreExact(parsed as string | number, task.answer as string | number);
      }
      return {
        k: v.k,
        raw: v.content,
        parsed,
        parseError: parsed === null,
        voteScore,
        invalidated: v.invalidated === true,
      };
    });

  const usable = votes.filter((v) => !v.invalidated);
  const parsedVotes = usable.filter((v) => !v.parseError);
  const parseErrorCount = usable.filter((v) => v.parseError).length;
  const base = {
    taskId: task.id,
    taskClass: task.taskClass,
    level,
    model,
    answerType: task.answerType,
    parseErrorCount,
    parse_error: usable.length > 0 && parsedVotes.length === 0,
    needsRerun: votes.some((v) => v.invalidated),
    votes,
  };

  if (task.answerType === 'set') {
    // Set type: per-vote F1 (parse errors score 0), aggregated by median.
    const score = usable.length === 0 ? 0 : median(usable.map((v) => v.voteScore));
    return { ...base, score, aggregation: 'median-f1', tie: false };
  }

  if (typeof task.answer === 'number') {
    // Numeric exact type: median of parsed numeric answers, then EM.
    const nums = parsedVotes
      .map((v) => Number(v.parsed))
      .filter((n) => Number.isFinite(n));
    const score = nums.length === 0 ? 0 : scoreExact(median(nums), task.answer);
    return { ...base, score, aggregation: 'median-em', tie: false };
  }

  // Categorical exact type: majority vote among parsed answers, then EM.
  const { winner, tie } = majorityVote(parsedVotes.map((v) => v.parsed as string | number));
  const score = winner === null ? 0 : scoreExact(winner, task.answer as string);
  return { ...base, score, aggregation: 'majority-em', tie };
}

// ---------------------------------------------------------------------------
// Long table over run results
// ---------------------------------------------------------------------------
export interface RunResultFile {
  taskId: string;
  level: Level;
  model: string;
  k: number;
  content: string;
  invalidated?: boolean;
}

export function scoreRuns(tasks: Task[], results: RunResultFile[]): ScoreRow[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const groups = new Map<string, RunResultFile[]>();
  for (const r of results) {
    const key = `${r.taskId} ${r.level} ${r.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const rows: ScoreRow[] = [];
  for (const [key, group] of groups) {
    const [taskId, level, model] = key.split(' ') as [string, Level, string];
    const task = taskById.get(taskId);
    if (!task) throw new Error(`run results reference unknown task '${taskId}'`);
    rows.push(
      aggregateVotes(
        task,
        level,
        model,
        group.map((g) => ({ k: g.k, content: g.content, invalidated: g.invalidated }))
      )
    );
  }
  return rows.sort(
    (a, b) =>
      a.taskId.localeCompare(b.taskId) ||
      a.level.localeCompare(b.level) ||
      a.model.localeCompare(b.model)
  );
}

export function loadRunResults(runDir: string): RunResultFile[] {
  const callsDir = path.join(runDir, 'calls');
  return readdirSync(callsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(callsDir, f), 'utf8')) as RunResultFile);
}

/* c8 ignore start -- CLI entry; logic above is unit-tested */
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const tasksPath = get('--tasks') ?? path.join(GT_DIR, 'tasks.json');
  const runDir = get('--run-dir') ?? RUNS_DIR;
  const outPath = get('--out') ?? path.join(runDir, 'scores.json');
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8')) as Task[];
  const rows = scoreRuns(tasks, loadRunResults(runDir));
  writeFileSync(outPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log(`scored ${rows.length} (task × level × model) rows -> ${outPath}`);
}
/* c8 ignore stop */
