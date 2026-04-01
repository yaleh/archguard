import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('sync-claude-skills', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.remove(dir)));
    tempDirs.length = 0;
  });

  it('syncs all direct child skill directories into the target directory', async () => {
    const sourceDir = await makeTempDir('archguard-skill-source-');
    const targetDir = await makeTempDir('archguard-skill-target-');
    tempDirs.push(sourceDir, targetDir);

    await fs.ensureDir(path.join(sourceDir, 'feature-developer'));
    await fs.ensureDir(path.join(sourceDir, 'project-semantics-discovery'));
    await fs.writeFile(path.join(sourceDir, 'feature-developer', 'SKILL.md'), 'feature');
    await fs.writeFile(
      path.join(sourceDir, 'project-semantics-discovery', 'SKILL.md'),
      'semantics'
    );

    const mod = await import('../../../scripts/sync-claude-skills.mjs');
    await mod.syncClaudeSkills(sourceDir, targetDir);

    expect(await fs.readFile(path.join(targetDir, 'feature-developer', 'SKILL.md'), 'utf-8')).toBe(
      'feature'
    );
    expect(
      await fs.readFile(path.join(targetDir, 'project-semantics-discovery', 'SKILL.md'), 'utf-8')
    ).toBe('semantics');
  });

  it('replaces stale contents for synced skills on re-sync', async () => {
    const sourceDir = await makeTempDir('archguard-skill-source-');
    const targetDir = await makeTempDir('archguard-skill-target-');
    tempDirs.push(sourceDir, targetDir);

    await fs.ensureDir(path.join(sourceDir, 'feature-developer'));
    await fs.writeFile(path.join(sourceDir, 'feature-developer', 'SKILL.md'), 'fresh');

    await fs.ensureDir(path.join(targetDir, 'feature-developer'));
    await fs.writeFile(path.join(targetDir, 'feature-developer', 'SKILL.md'), 'stale');
    await fs.writeFile(path.join(targetDir, 'feature-developer', 'old.txt'), 'remove me');

    const mod = await import('../../../scripts/sync-claude-skills.mjs');
    await mod.syncClaudeSkills(sourceDir, targetDir);

    expect(await fs.readFile(path.join(targetDir, 'feature-developer', 'SKILL.md'), 'utf-8')).toBe(
      'fresh'
    );
    expect(await fs.pathExists(path.join(targetDir, 'feature-developer', 'old.txt'))).toBe(false);
  });

  it('preserves unrelated target directories that are not repo-owned skills', async () => {
    const sourceDir = await makeTempDir('archguard-skill-source-');
    const targetDir = await makeTempDir('archguard-skill-target-');
    tempDirs.push(sourceDir, targetDir);

    await fs.ensureDir(path.join(sourceDir, 'feature-developer'));
    await fs.writeFile(path.join(sourceDir, 'feature-developer', 'SKILL.md'), 'feature');

    await fs.ensureDir(path.join(targetDir, 'user-private-skill'));
    await fs.writeFile(path.join(targetDir, 'user-private-skill', 'SKILL.md'), 'keep');

    const mod = await import('../../../scripts/sync-claude-skills.mjs');
    await mod.syncClaudeSkills(sourceDir, targetDir);

    expect(await fs.readFile(path.join(targetDir, 'user-private-skill', 'SKILL.md'), 'utf-8')).toBe(
      'keep'
    );
  });
});
