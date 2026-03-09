import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { planGoAnalysisScope } from '@/plugins/golang/source-scope.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'archguard-go-scope-'));
}

describe('planGoAnalysisScope', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
  });

  it('resolves subdirectory sources to the nearest module root and keeps only requested trees', async () => {
    const root = await makeTempDir();
    tempDirs.push(root);

    await fs.ensureDir(path.join(root, 'cmd/swarm'));
    await fs.ensureDir(path.join(root, 'pkg/hub'));
    await fs.ensureDir(path.join(root, 'docs'));
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/root\n');

    const plan = await planGoAnalysisScope([
      path.join(root, 'cmd'),
      path.join(root, 'pkg'),
      path.join(root, 'docs'),
    ]);

    expect(plan.workspaceRoot).toBe(root);
    expect(plan.includePatterns).toEqual(['cmd/**/*.go', 'pkg/**/*.go', 'docs/**/*.go']);
    expect(plan.excludePatterns).not.toContain('cmd/**');
  });

  it('excludes nested modules by default when analyzing a parent module root', async () => {
    const root = await makeTempDir();
    tempDirs.push(root);

    await fs.ensureDir(path.join(root, 'pkg/hub'));
    await fs.ensureDir(path.join(root, 'examples/user-service'));
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/root\n');
    await fs.writeFile(
      path.join(root, 'examples/user-service/go.mod'),
      'module example.com/nested\n'
    );

    const plan = await planGoAnalysisScope([root]);

    expect(plan.workspaceRoot).toBe(root);
    expect(plan.includePatterns).toEqual(['**/*.go']);
    expect(plan.excludePatterns).toContain('examples/user-service/**');
  });

  it('rejects source sets that span multiple Go modules', async () => {
    const root = await makeTempDir();
    tempDirs.push(root);

    await fs.ensureDir(path.join(root, 'pkg/hub'));
    await fs.ensureDir(path.join(root, 'examples/user-service'));
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/root\n');
    await fs.writeFile(
      path.join(root, 'examples/user-service/go.mod'),
      'module example.com/nested\n'
    );

    await expect(
      planGoAnalysisScope([path.join(root, 'pkg'), path.join(root, 'examples/user-service')])
    ).rejects.toThrow(/span multiple Go modules/i);
  });
});
