import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { ProjectSemanticsInputSchema } from '@/types/extensions/project-semantics.js';

const skillDir = path.resolve('.agents/skills/project-semantics-discovery');
const skillPath = path.join(skillDir, 'SKILL.md');
const examplePath = path.join(skillDir, 'references', 'archguard-project-semantics.json');

describe('project-semantics-discovery skill', () => {
  it('ships the required skill files', async () => {
    expect(await fs.pathExists(skillPath)).toBe(true);
    expect(await fs.pathExists(examplePath)).toBe(true);
  });

  it('ships an example semantics payload that matches ProjectSemanticsInputSchema', async () => {
    const raw = await fs.readJson(examplePath);
    const parsed = ProjectSemanticsInputSchema.safeParse(raw);

    expect(parsed.success).toBe(true);
    expect(raw.architecturalLayers).toEqual({
      'src/analysis': 'analysis',
      'src/cli': 'cli',
      'src/mermaid': 'rendering',
    });
  });

  it('documents the three priority knowledge areas', async () => {
    const skill = await fs.readFile(skillPath, 'utf-8');

    expect(skill).toContain('test discovery');
    expect(skill).toContain('assertion wrapper');
    expect(skill).toContain('Mermaid');
    expect(skill).toContain('.archguard/project-semantics.json');
  });
});
