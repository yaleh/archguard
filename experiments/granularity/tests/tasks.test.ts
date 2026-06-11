import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  instantiateTasks,
  loadGroundTruth,
  type GroundTruth,
} from '../tasks/instantiate';
import {
  A_TASK_TYPES,
  B_TASK_TYPES,
  validateTask,
  validateTasks,
  type Task,
} from '../tasks/schema';
import { ANSWER_FORMAT_EXACT, ANSWER_FORMAT_SET, TEMPLATES } from '../tasks/templates';

const FIXTURES = path.join(__dirname, 'fixtures', 'tasks');
const gtFixture = JSON.parse(
  readFileSync(path.join(FIXTURES, 'gt.fixture.json'), 'utf8')
) as GroundTruth;
const mappingFixture = JSON.parse(
  readFileSync(path.join(FIXTURES, 'mapping.fixture.json'), 'utf8')
) as Record<string, string>;

const validATask: Task = {
  id: 'modA-cycles-1',
  taskClass: 'A',
  module: 'modA',
  taskType: 'cycles',
  prompt: `List cycle members. ${ANSWER_FORMAT_SET}`,
  entities: ['Pf3', 'Rt5'],
  answerType: 'set',
  answer: ['Pf3', 'Rt5'],
};

const validBTask: Task = {
  id: 'modA-most-called-method-1',
  taskClass: 'B',
  module: 'modA',
  taskType: 'most-called-method',
  prompt: `Most called method? ${ANSWER_FORMAT_EXACT}`,
  entities: ['Pf3'],
  answerType: 'exact',
  answer: 'Pf3.m4',
  gtVariant: 'expanded',
};

describe('task schema validation', () => {
  it('accepts a valid A-class set task', () => {
    expect(validateTask(validATask)).toEqual({ valid: true, errors: [] });
  });

  it('accepts a valid B-class exact task with gtVariant', () => {
    expect(validateTask(validBTask)).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-objects', () => {
    expect(validateTask(null).valid).toBe(false);
    expect(validateTask([validATask]).valid).toBe(false);
    expect(validateTask('task').valid).toBe(false);
  });

  it('rejects a task with missing/empty id', () => {
    const r = validateTask({ ...validATask, id: '' });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/id/);
  });

  it('rejects a B-class task without gtVariant', () => {
    const { gtVariant: _gtVariant, ...noVariant } = validBTask;
    const r = validateTask(noVariant);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/gtVariant/);
  });

  it('rejects gtVariant on A-class tasks', () => {
    const r = validateTask({ ...validATask, gtVariant: 'expanded' });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/gtVariant/);
  });

  it('rejects an A-class task with a B-class task type', () => {
    const r = validateTask({ ...validATask, taskType: 'callers-into' });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/not an A-class/);
  });

  it("rejects answerType 'set' with a non-array answer", () => {
    const r = validateTask({ ...validATask, answer: 'Pf3' });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/answer/);
  });

  it("rejects answerType 'exact' with an array answer", () => {
    const r = validateTask({ ...validBTask, answer: ['Pf3.m4'] });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/answer/);
  });

  it('rejects a prompt that does not pin the JSON answer format', () => {
    const r = validateTask({ ...validATask, prompt: 'just answer freely' });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/JSON answer format/);
  });

  it('validateTasks rejects duplicate ids and non-arrays', () => {
    expect(validateTasks('nope').valid).toBe(false);
    const r = validateTasks([validATask, validATask]);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/duplicate/);
  });
});

describe('templates (§6 coverage)', () => {
  it('covers every §6 task type with matching class and answer type', () => {
    for (const t of A_TASK_TYPES) {
      expect(TEMPLATES[t].taskClass).toBe('A');
    }
    for (const t of B_TASK_TYPES) {
      expect(TEMPLATES[t].taskClass).toBe('B');
    }
    expect(Object.keys(TEMPLATES).sort()).toEqual([...A_TASK_TYPES, ...B_TASK_TYPES].sort());
  });

  it('every rendered template pins the JSON answer format', () => {
    const params = { fromPackage: 'p1', toPackage: 'p2', method: 'Pf3.m4', target: 'Pf3' };
    for (const template of Object.values(TEMPLATES)) {
      expect(template.render(params)).toContain('"answer"');
    }
  });

  it('throws when a required parameter is missing', () => {
    expect(() => TEMPLATES['callers-into'].render({})).toThrow(/target/);
  });
});

describe('instantiateTasks on fixture GT', () => {
  const tasks = instantiateTasks(gtFixture);

  it('produces schema-valid tasks only', () => {
    expect(validateTasks(tasks)).toEqual({ valid: true, errors: [] });
  });

  it('covers all §6 task types present in the fixture GT', () => {
    const types = new Set(tasks.map((t) => t.taskType));
    expect([...types].sort()).toEqual([...A_TASK_TYPES, ...B_TASK_TYPES].sort());
  });

  it('computes the highest in-degree entity (unique max)', () => {
    const t = tasks.find((x) => x.taskType === 'highest-in-degree')!;
    expect(t.answer).toBe('Pf3');
    expect(t.answerType).toBe('exact');
  });

  it('computes cross-package dependency sets', () => {
    const t = tasks.find((x) => x.taskType === 'inter-layer-deps')!;
    expect(t.answer).toEqual(['Xq7', 'Zk2']);
    expect(t.prompt).toContain('p1');
    expect(t.prompt).toContain('p2');
  });

  it('computes cycle participants and articulation points', () => {
    expect(tasks.find((x) => x.taskType === 'cycles')!.answer).toEqual(['Pf3', 'Rt5']);
    expect(tasks.find((x) => x.taskType === 'articulation-point')!.answer).toEqual(['Pf3']);
  });

  it('computes B-class answers from the call graph with gtVariant attached', () => {
    const impact = tasks.find((x) => x.taskType === 'signature-change-impact')!;
    expect(impact.answer).toEqual(['Qm9.m3', 'Xq7.m1', 'Zk2.m2']);
    expect(impact.gtVariant).toBe('expanded');

    const most = tasks.find((x) => x.taskType === 'most-called-method')!;
    expect(most.answer).toBe('Pf3.m4');
    expect(most.gtVariant).toBe('expanded');

    const callersInto = tasks.filter((x) => x.taskType === 'callers-into');
    expect(callersInto.length).toBeGreaterThan(0);
    for (const t of callersInto) expect(t.gtVariant).toBe('expanded');
  });

  it("honours the gtVariant option ('interface-member')", () => {
    const variantTasks = instantiateTasks(gtFixture, { gtVariant: 'interface-member' });
    for (const t of variantTasks.filter((x) => x.taskClass === 'B')) {
      expect(t.gtVariant).toBe('interface-member');
    }
  });

  it('emits no prompt containing any original (pre-obfuscation) name', () => {
    for (const task of tasks) {
      for (const original of Object.values(mappingFixture)) {
        expect(task.prompt).not.toContain(original);
      }
    }
  });
});

describe('loadGroundTruth', () => {
  it('loads the fixture GT', () => {
    expect(loadGroundTruth(path.join(FIXTURES, 'gt.fixture.json')).module).toBe('modA');
  });

  it('refuses to read mapping.json', () => {
    expect(() => loadGroundTruth(path.join(FIXTURES, 'mapping.json'))).toThrow(/mapping\.json/);
  });
});
