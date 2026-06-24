import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SKILL_PATH = path.resolve(process.cwd(), '.claude/skills/cognitive-analysis/SKILL.md');

describe('cognitive-analysis SKILL.md', () => {
  it('SKILL.md exists at correct path', () => {
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
  });

  it('SKILL.md has required frontmatter fields', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('name: cognitive-analysis');
    expect(content).toContain('allowed-tools:');
    expect(content).toContain('argument-hint:');
  });

  it('SKILL.md documents all 5 steps', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('Probe');
    expect(content).toContain('Focus');
    expect(content).toContain('Deep Dive');
    expect(content).toContain('Synthesize');
    expect(content).toContain('Cache');
  });

  it('SKILL.md references archguard_get_cognitive_summary', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('archguard_get_cognitive_summary');
  });

  it('SKILL.md defines Pattern A, Pattern B, Pattern C', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('Pattern A');
    expect(content).toContain('Pattern B');
    expect(content).toContain('Pattern C');
  });

  it('SKILL.md includes heatmap output format', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('heatmap');
  });

  it('SKILL.md validation section documents expected classifications', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('query-engine.ts');
    expect(content).toContain('flow-graph-builder.ts');
  });
});
