import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  aggregateVotes,
  loadRunResults,
  majorityVote,
  median,
  parseModelAnswer,
  scoreExact,
  scoreRuns,
  scoreSetF1,
  type RunResultFile,
} from '../score';
import type { Task } from '../tasks/schema';

const FIXTURES = path.join(__dirname, 'fixtures', 'tasks');
const tasks = JSON.parse(readFileSync(path.join(FIXTURES, 'tasks.fixture.json'), 'utf8')) as Task[];
const setTask = tasks.find((t) => t.id === 'modA-signature-change-impact-1')!; // answer: Qm9.m3, Xq7.m1, Zk2.m2
const exactTask = tasks.find((t) => t.id === 'modA-most-called-method-1')!; // answer: Pf3.m4

describe('parseModelAnswer', () => {
  it('parses the pinned JSON shape for set and exact answers', () => {
    expect(parseModelAnswer('{"answer": ["A", "B"]}', 'set')).toEqual(['A', 'B']);
    expect(parseModelAnswer('{"answer": "Pf3.m4"}', 'exact')).toBe('Pf3.m4');
    expect(parseModelAnswer('{"answer": 7}', 'exact')).toBe(7);
    expect(parseModelAnswer('{"answer": []}', 'set')).toEqual([]);
  });

  it('tolerates markdown fences and surrounding prose', () => {
    expect(parseModelAnswer('```json\n{"answer": ["A"]}\n```', 'set')).toEqual(['A']);
    expect(parseModelAnswer('Sure! Here it is: {"answer": "X"} hope that helps', 'exact')).toBe('X');
  });

  it('returns null on garbage, wrong shapes and type mismatches', () => {
    expect(parseModelAnswer('I think the answer is Pf3', 'exact')).toBeNull();
    expect(parseModelAnswer('{"result": "Pf3"}', 'exact')).toBeNull();
    expect(parseModelAnswer('{"answer": "Pf3"}', 'set')).toBeNull(); // set expects array
    expect(parseModelAnswer('{"answer": [{"x": 1}]}', 'set')).toBeNull();
    expect(parseModelAnswer('{"answer": [true]}', 'set')).toBeNull();
    expect(parseModelAnswer('', 'exact')).toBeNull();
  });
});

describe('scoreSetF1 boundaries', () => {
  it('both empty → 1; one side empty → 0', () => {
    expect(scoreSetF1([], [])).toBe(1);
    expect(scoreSetF1([], ['A'])).toBe(0);
    expect(scoreSetF1(['A'], [])).toBe(0);
  });

  it('full match → 1 (order- and duplicate-insensitive)', () => {
    expect(scoreSetF1(['B', 'A', 'A'], ['A', 'B'])).toBe(1);
  });

  it('half match → harmonic mean of precision and recall', () => {
    // predicted {A, C} vs gold {A, B}: P = 0.5, R = 0.5 → F1 = 0.5
    expect(scoreSetF1(['A', 'C'], ['A', 'B'])).toBeCloseTo(0.5, 10);
    // predicted {A} vs gold {A, B}: P = 1, R = 0.5 → F1 = 2/3
    expect(scoreSetF1(['A'], ['A', 'B'])).toBeCloseTo(2 / 3, 10);
  });

  it('no overlap → 0', () => {
    expect(scoreSetF1(['X'], ['A', 'B'])).toBe(0);
  });
});

describe('majorityVote tie rule (frozen)', () => {
  it('strict majority wins without a tie flag', () => {
    expect(majorityVote(['A', 'A', 'B'])).toEqual({ winner: 'A', tie: false });
  });

  it('tie → lexicographically smallest top candidate, flagged tie', () => {
    expect(majorityVote(['B', 'A', 'B', 'A', 'C'])).toEqual({ winner: 'A', tie: true });
  });

  it('empty input → no winner', () => {
    expect(majorityVote([])).toEqual({ winner: null, tie: false });
  });
});

describe('median', () => {
  it('odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5])).toBe(5);
  });

  it('throws on empty input', () => {
    expect(() => median([])).toThrow(/empty/);
  });
});

describe('aggregateVotes', () => {
  const votes = (contents: string[], invalidated: boolean[] = []) =>
    contents.map((content, i) => ({ k: i + 1, content, invalidated: invalidated[i] ?? false }));

  it('set type: median of per-vote F1, parse errors scoring 0', () => {
    const row = aggregateVotes(setTask, 'L3', 'gpt-5.4', votes([
      '{"answer": ["Qm9.m3", "Xq7.m1", "Zk2.m2"]}', // F1 = 1
      '{"answer": ["Qm9.m3", "Xq7.m1", "Zk2.m2"]}', // F1 = 1
      '{"answer": ["Qm9.m3"]}', // P=1, R=1/3 → F1 = 0.5
      'no json at all', // parse error → 0
      '{"answer": []}', // empty vs non-empty gold → 0
    ]));
    expect(row.aggregation).toBe('median-f1');
    expect(row.score).toBe(0.5); // median of [1, 1, 0.5, 0, 0]
    expect(row.parseErrorCount).toBe(1);
    expect(row.parse_error).toBe(false);
    expect(row.votes).toHaveLength(5);
    expect(row.votes.map((v) => v.k)).toEqual([1, 2, 3, 4, 5]);
  });

  it('categorical exact type: majority vote then EM', () => {
    const row = aggregateVotes(exactTask, 'L4', 'deepseek-v4-flash', votes([
      '{"answer": "Pf3.m4"}',
      '{"answer": "Pf3.m4"}',
      '{"answer": "Pf3.m4"}',
      '{"answer": "Rt5.m5"}',
      '{"answer": "Rt5.m5"}',
    ]));
    expect(row.aggregation).toBe('majority-em');
    expect(row.score).toBe(1);
    expect(row.tie).toBe(false);
  });

  it('categorical tie: lexicographically smallest tied candidate, tie flagged, gold not consulted', () => {
    // 2 votes "Rt5.m5" vs 2 votes "Pf3.m4" (gold) + 1 parse error.
    // Tie between Pf3.m4 and Rt5.m5 → winner Pf3.m4 only because it sorts first.
    const row = aggregateVotes(exactTask, 'L4', 'gpt-5.4', votes([
      '{"answer": "Rt5.m5"}',
      '{"answer": "Pf3.m4"}',
      '{"answer": "Rt5.m5"}',
      '{"answer": "Pf3.m4"}',
      'garbled',
    ]));
    expect(row.tie).toBe(true);
    expect(row.score).toBe(1);

    // Same tie where the lexicographically smallest candidate is NOT gold → 0.
    const row2 = aggregateVotes(exactTask, 'L4', 'gpt-5.4', votes([
      '{"answer": "Aa0.m0"}',
      '{"answer": "Aa0.m0"}',
      '{"answer": "Pf3.m4"}',
      '{"answer": "Pf3.m4"}',
      'garbled',
    ]));
    expect(row2.tie).toBe(true);
    expect(row2.score).toBe(0);
  });

  it('numeric exact type: median of parsed numbers then EM', () => {
    const numericTask: Task = { ...exactTask, id: 'modA-num-1', answer: 7 };
    const row = aggregateVotes(numericTask, 'L5', 'gpt-5.4', votes([
      '{"answer": 6}',
      '{"answer": 7}',
      '{"answer": 7}',
      '{"answer": 9}',
      '{"answer": 12}',
    ]));
    expect(row.aggregation).toBe('median-em');
    expect(row.score).toBe(1); // median 7 === gold 7
    const off = aggregateVotes(numericTask, 'L5', 'gpt-5.4', votes(['{"answer": 6}']));
    expect(off.score).toBe(0);
  });

  it('all votes unparseable → score 0 with parse_error flag', () => {
    const row = aggregateVotes(setTask, 'L3', 'gpt-5.4', votes(['x', 'y', 'z', '?', '!']));
    expect(row.score).toBe(0);
    expect(row.parse_error).toBe(true);
    expect(row.parseErrorCount).toBe(5);
  });

  it('invalidated votes are excluded from the score and set needsRerun', () => {
    const row = aggregateVotes(
      setTask,
      'L3',
      'gpt-5.4',
      votes(
        [
          '{"answer": ["Qm9.m3", "Xq7.m1", "Zk2.m2"]}',
          '{"answer": ["Qm9.m3", "Xq7.m1", "Zk2.m2"]}',
          '{"answer": []}', // invalidated → must not drag the median down
        ],
        [false, false, true]
      )
    );
    expect(row.needsRerun).toBe(true);
    expect(row.score).toBe(1); // median over the two valid votes only
  });
});

describe('scoreRuns long table (analyze.py contract)', () => {
  function makeResults(): RunResultFile[] {
    const results: RunResultFile[] = [];
    for (const task of tasks) {
      for (const level of ['L3', 'L5'] as const) {
        for (const model of ['deepseek-v4-flash', 'gpt-5.4']) {
          for (let k = 1; k <= 5; k++) {
            results.push({
              taskId: task.id,
              level,
              model,
              k,
              content: JSON.stringify({ answer: task.answer }),
            });
          }
        }
      }
    }
    return results;
  }

  it('produces one row per (task × level × model) with all contract fields, perfectly scored', () => {
    const rows = scoreRuns(tasks, makeResults());
    expect(rows).toHaveLength(tasks.length * 2 * 2);
    for (const row of rows) {
      expect(row).toMatchObject({ score: 1, parse_error: false, needsRerun: false });
      expect(['A', 'B']).toContain(row.taskClass);
      expect(['set', 'exact']).toContain(row.answerType);
      expect(row.votes).toHaveLength(5);
      expect(typeof row.taskId).toBe('string');
      expect(typeof row.level).toBe('string');
      expect(typeof row.model).toBe('string');
    }
    // deterministic sort: taskId, then level, then model
    const keys = rows.map((r) => `${r.taskId}|${r.level}|${r.model}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('throws when results reference an unknown task', () => {
    expect(() =>
      scoreRuns(tasks, [{ taskId: 'ghost-1', level: 'L3', model: 'gpt-5.4', k: 1, content: '{}' }])
    ).toThrow(/unknown task 'ghost-1'/);
  });

  it('end-to-end from a run directory via loadRunResults', () => {
    const runDir = mkdtempSync(path.join(os.tmpdir(), 'granularity-score-'));
    try {
      const callsDir = path.join(runDir, 'calls');
      mkdirSync(callsDir, { recursive: true });
      const results = makeResults();
      results.forEach((r, i) => {
        writeFileSync(path.join(callsDir, `call-${i}.json`), JSON.stringify(r), 'utf8');
      });
      writeFileSync(path.join(callsDir, '.probed'), '', 'utf8'); // non-JSON marker must be ignored

      const rows = scoreRuns(tasks, loadRunResults(runDir));
      expect(rows).toHaveLength(tasks.length * 2 * 2);
      expect(rows.every((r) => r.score === 1)).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('scoreExact', () => {
  it('string and number comparisons via canonical string form', () => {
    expect(scoreExact('Pf3.m4', 'Pf3.m4')).toBe(1);
    expect(scoreExact('Pf3.m4', 'Pf3.m5')).toBe(0);
    expect(scoreExact(7, 7)).toBe(1);
    expect(scoreExact('7', 7)).toBe(1);
  });
});
