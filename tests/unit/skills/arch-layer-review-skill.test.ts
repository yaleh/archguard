import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'path';

const skillDir = path.resolve('.agents/skills/arch-layer-review');
const skillPath = path.join(skillDir, 'SKILL.md');
const examplePath = path.join(skillDir, 'references', 'goal-030-example-output.json');
const selfReviewPath = path.join(
  skillDir,
  'references',
  'archguard-selfreview-example-output.json'
);

/** Collect every object key appearing anywhere in a parsed JSON value. */
function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      collectKeys(child, out);
    }
  }
  return out;
}

function parseFrontmatter(skill: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(skill);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

describe('arch-layer-review skill', () => {
  it('ships the required skill files', async () => {
    expect(await fs.pathExists(skillPath)).toBe(true);
    expect(await fs.pathExists(examplePath)).toBe(true);
  });

  it('has a non-empty name/description frontmatter (same shape as cognitive-analysis)', async () => {
    const skill = await fs.readFile(skillPath, 'utf-8');
    const fm = parseFrontmatter(skill);

    expect(fm.name).toBe('arch-layer-review');
    expect(fm.description).toBeTruthy();
    expect(fm.description.length).toBeGreaterThan(20);
  });

  it('ships a parseable example with the three physical-partition top-level keys', async () => {
    const raw = await fs.readJson(examplePath);

    expect(typeof raw).toBe('object');
    expect(raw).toHaveProperty('facts');
    expect(raw).toHaveProperty('declaredRules');
    expect(raw).toHaveProperty('judgment');
  });

  it('gives every judgment conclusion a non-empty evidence array', async () => {
    const raw = await fs.readJson(examplePath);

    const conclusions = raw.judgment.conclusions;
    expect(Array.isArray(conclusions)).toBe(true);
    expect(conclusions.length).toBeGreaterThan(0);

    for (const conclusion of conclusions) {
      expect(Array.isArray(conclusion.evidence)).toBe(true);
      expect(conclusion.evidence.length).toBeGreaterThan(0);
      expect(typeof conclusion.verdict).toBe('string');
    }
  });

  it('covers the three GOAL-030 traps with hit/miss + reason + evidence', async () => {
    const raw = await fs.readJson(examplePath);

    const checklist = raw.judgment.trapChecklist;
    expect(Array.isArray(checklist)).toBe(true);
    expect(checklist.length).toBeGreaterThanOrEqual(3);

    for (const entry of checklist) {
      expect(typeof entry.trap).toBe('string');
      expect(entry.trap.length).toBeGreaterThan(0);
      expect(typeof entry.hit).toBe('boolean');
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.evidence)).toBe(true);
      expect(entry.evidence.length).toBeGreaterThan(0);
    }

    const traps = checklist.map((e: { trap: string }) => e.trap).join(' ');
    expect(traps).toMatch(/搬壳|搬文件/);
    expect(traps).toContain('第三套实现');
    expect(traps).toMatch(/接口形状/);
  });

  it('never exposes a mechanical gate verdict shape (no exitCode/pass/fail)', async () => {
    const text = await fs.readFile(examplePath, 'utf-8');
    const raw = await fs.readJson(examplePath);

    // Literal field-write shapes that would read as a deterministic gate result.
    expect(text).not.toContain('"exitCode"');
    expect(text).not.toContain('"pass":');
    expect(text).not.toContain('"fail":');

    // Recursive key scan: no object key may be named like a gate verdict.
    const keys = collectKeys(raw);
    for (const forbidden of ['exitCode', 'pass', 'fail', 'passed', 'failed', 'statusCode']) {
      expect(keys).not.toContain(forbidden);
    }

    // The four-state vocabulary must not use pass/fail as a verdict value either.
    for (const conclusion of raw.judgment.conclusions) {
      expect(['converged', 'cosmetic', 'regressed', 'not-evaluated']).toContain(conclusion.verdict);
      expect(JSON.stringify(conclusion)).not.toMatch(/"pass"|"fail"/);
    }
  });

  it('declares the boundary: consumes check-layers.mjs without changing its authority', async () => {
    const skill = await fs.readFile(skillPath, 'utf-8');

    // Reuse, not a new deterministic checker.
    expect(skill).toContain('check-layers.mjs');
    expect(skill).toContain('moduleGraph');
    expect(skill).toContain('not-evaluated');
    expect(skill).toContain('evidence');

    // The four MVP judgment themes.
    expect(skill).toContain('ownership');
    expect(skill).toContain('orchestrator');
    expect(skill).toContain('domain state');
    expect(skill).toMatch(/搬壳|搬文件/);

    // Deliberately excluded (NOT in MVP) scope markers.
    expect(skill).toContain('DDD');
    expect(skill).toContain('OOD');
    expect(skill).toContain('架构风格');
    expect(skill).toContain('评分');
  });
});

describe('arch-layer-review skill — single-tree / architecture-health mode', () => {
  it('ships the single-tree example and it covers the four new question classes', async () => {
    expect(await fs.pathExists(selfReviewPath)).toBe(true);
    const raw = await fs.readJson(selfReviewPath);

    // Same three physical-partition top-level keys as the before/after example.
    expect(typeof raw).toBe('object');
    expect(raw).toHaveProperty('facts');
    expect(raw).toHaveProperty('declaredRules');
    expect(raw).toHaveProperty('judgment');

    const conclusions = raw.judgment.conclusions;
    expect(Array.isArray(conclusions)).toBe(true);
    expect(conclusions.length).toBeGreaterThanOrEqual(4);

    for (const conclusion of conclusions) {
      expect(Array.isArray(conclusion.evidence)).toBe(true);
      expect(conclusion.evidence.length).toBeGreaterThan(0);
      expect(['converged', 'cosmetic', 'regressed', 'not-evaluated']).toContain(
        conclusion.verdict
      );
    }

    // All four single-tree question classes are present.
    const ids = conclusions.map((c: { id: string }) => c.id);
    for (const id of [
      'cross-layer-cycle-coverage',
      'intra-layer-cycle-exposure',
      'leaf-layer-purity',
      'declaration-coverage-gap',
    ]) {
      expect(ids).toContain(id);
    }

    // At least one evidence item cites a real 2026-10-08 dogfooding reading,
    // not generic placeholder text.
    const blob = JSON.stringify(raw);
    expect(blob).toMatch(/src\/cli\/utils -> src\/cli\/(analyze|processors)/);
    expect(blob).toMatch(/src\/plugins\/shared -> src\/core\/parser-runtime/);
  });

  it('never exposes a mechanical gate verdict shape in the single-tree example', async () => {
    const text = await fs.readFile(selfReviewPath, 'utf-8');
    const raw = await fs.readJson(selfReviewPath);

    // Literal field-write shapes that would read as a deterministic gate result.
    expect(text).not.toContain('"exitCode"');
    expect(text).not.toContain('"pass":');
    expect(text).not.toContain('"fail":');

    // Recursive key scan: no object key may be named like a gate verdict.
    const keys = collectKeys(raw);
    for (const forbidden of ['exitCode', 'pass', 'fail', 'passed', 'failed', 'statusCode']) {
      expect(keys).not.toContain(forbidden);
    }

    // The four-state vocabulary must not use pass/fail as a verdict value either.
    for (const conclusion of raw.judgment.conclusions) {
      expect(['converged', 'cosmetic', 'regressed', 'not-evaluated']).toContain(
        conclusion.verdict
      );
      expect(JSON.stringify(conclusion)).not.toMatch(/"pass"|"fail"/);
    }
  });

  it('SKILL.md carries the single-tree section, keys the new questions, and keeps the four MVP questions', async () => {
    const skill = await fs.readFile(skillPath, 'utf-8');

    // New single-tree question-set markers (grep-able).
    expect(skill).toContain('Single-tree');
    expect(skill).toContain('cross-layer');
    expect(skill).toContain('intra-layer');
    expect(skill).toContain('leaf');
    expect(skill).toContain('coverage gap');

    // Explicitly coexists with the before/after four questions — not a replacement.
    expect(skill).toMatch(/coexist|并存|not replace|不替代/);

    // The original four MVP questions are still asserted to exist (guard against
    // this task having damaged the pre-existing section).
    expect(skill).toContain('ownership');
    expect(skill).toContain('orchestrator');
    expect(skill).toContain('domain state');
    expect(skill).toMatch(/搬壳|搬文件/);

    // The consumed-mechanism boundary markers are untouched.
    expect(skill).toContain('check-layers.mjs');
    expect(skill).toContain('moduleGraph');
    expect(skill).toContain('not-evaluated');
  });
});

describe('arch-layer-review skill — drift / cycle-classification consumption', () => {
  const driftExamplePath = path.join(
    skillDir,
    'references',
    'goal-030-drift-and-stale-declaration-example.json'
  );

  it('ships the drift worked example with the three physical-partition keys', async () => {
    expect(await fs.pathExists(driftExamplePath)).toBe(true);
    const raw = await fs.readJson(driftExamplePath);

    expect(typeof raw).toBe('object');
    expect(raw).toHaveProperty('facts');
    expect(raw).toHaveProperty('declaredRules');
    expect(raw).toHaveProperty('judgment');
  });

  it('classifies the real gate/lifecycle.ts -> kernel/task-transition.ts edge as new-and-undeclared', async () => {
    const raw = await fs.readJson(driftExamplePath);

    const record = raw.declaredRules.driftReport.find(
      (d: { edge: { from: string; to: string } }) =>
        d.edge.from === 'core-gate' && d.edge.to === 'core-kernel'
    );
    expect(record).toBeDefined();
    expect(record.classification).toBe('new-and-undeclared');
    expect(record.evidence).toEqual({
      beforePresent: false,
      afterPresent: true,
      declared: false,
    });

    // The evidence cites the real quay source edge, not a generic placeholder.
    const blob = JSON.stringify(raw);
    expect(blob).toContain('gate/lifecycle.ts');
    expect(blob).toContain('kernel/task-transition.ts');
  });

  it('annotates a stale declaration without adding a fifth verdict state', async () => {
    const raw = await fs.readJson(driftExamplePath);

    const stale = raw.judgment.conclusions.filter(
      (c: { declarationStatus?: string }) => c.declarationStatus === 'stale'
    );
    expect(stale.length).toBeGreaterThan(0);
    for (const conclusion of stale) {
      expect(typeof conclusion.recommendedDeclarationUpdate).toBe('string');
      expect(conclusion.recommendedDeclarationUpdate.length).toBeGreaterThan(0);
      // declarationStatus supplements the verdict — it is not a verdict itself.
      expect(['converged', 'cosmetic', 'regressed', 'not-evaluated']).toContain(
        conclusion.verdict
      );
    }

    // Every conclusion keeps a non-empty evidence array, exactly as before.
    for (const conclusion of raw.judgment.conclusions) {
      expect(Array.isArray(conclusion.evidence)).toBe(true);
      expect(conclusion.evidence.length).toBeGreaterThan(0);
    }

    // `declarationStatus` is explicitly documented as independent of, not a
    // replacement for, the four-state verdict vocabulary.
    const skill = await fs.readFile(skillPath, 'utf-8');
    expect(skill).toContain('declarationStatus');
    expect(skill).toMatch(/fifth `verdict` state|not another verdict/i);
    expect(skill).toContain('--before');
    expect(skill).toContain('--classify-cycles');
  });

  it('never exposes a mechanical gate verdict shape in the drift example', async () => {
    const text = await fs.readFile(driftExamplePath, 'utf-8');
    const raw = await fs.readJson(driftExamplePath);

    expect(text).not.toContain('"exitCode"');
    expect(text).not.toContain('"pass":');
    expect(text).not.toContain('"fail":');

    const keys = collectKeys(raw);
    for (const forbidden of ['exitCode', 'pass', 'fail', 'passed', 'failed', 'statusCode']) {
      expect(keys).not.toContain(forbidden);
    }

    for (const conclusion of raw.judgment.conclusions) {
      expect(['converged', 'cosmetic', 'regressed', 'not-evaluated']).toContain(
        conclusion.verdict
      );
      expect(JSON.stringify(conclusion)).not.toMatch(/"pass"|"fail"/);
    }
  });

  it('keeps the plugin/ and .agents/ skill copies byte-identical', async () => {
    for (const rel of [
      'SKILL.md',
      path.join('references', 'goal-030-drift-and-stale-declaration-example.json'),
      path.join('references', 'goal-030-example-output.json'),
      path.join('references', 'archguard-selfreview-example-output.json'),
    ]) {
      const agents = await fs.readFile(path.join('.agents', 'skills', 'arch-layer-review', rel), 'utf-8');
      const plugin = await fs.readFile(path.join('plugin', 'skills', 'arch-layer-review', rel), 'utf-8');
      expect(plugin).toBe(agents);
    }
  });
});
