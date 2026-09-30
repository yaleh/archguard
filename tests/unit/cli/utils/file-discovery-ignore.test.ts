import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';

describe('FileDiscoveryService ignore files', () => {
  let root: string;
  const w = (rel: string, c = 'export const x = 1;') => fs.outputFile(path.join(root, rel), c);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-ignore-'));
    await w('src/keep.ts');
    await w('gen/generated.ts');
    await w('archive/old.ts');
    await w('legacy/l.ts');
  });
  afterEach(() => fs.remove(root));

  it('excludes .gitignore directories and reports them', async () => {
    await w('.gitignore', 'gen/\n');
    const svc = new FileDiscoveryService();
    const files = await svc.discoverFiles({ sources: [root] });
    expect(files.some((f) => f.includes('/gen/'))).toBe(false);
    expect(files.some((f) => f.includes('/src/keep.ts'))).toBe(true);
    const report = svc.formatExcludeReport().join('\n');
    expect(report).toContain('.gitignore: 1 rule(s)');
    expect(report).toContain('excluded 1 file(s)');
  });

  it('unions .archguardignore, .gitignore and config exclude', async () => {
    await w('.gitignore', 'gen/\n');
    await w('.archguardignore', '# c\narchive/\n');
    const svc = new FileDiscoveryService();
    const files = await svc.discoverFiles({ sources: [root], exclude: ['**/legacy/**'] });
    expect(files.map((f) => path.relative(root, f))).toEqual(['src/keep.ts']);
    const sources = svc
      .getExcludeReport()
      .map((e) => e.source)
      .sort();
    expect(sources).toEqual(['.archguardignore', '.gitignore', 'config exclude']);
  });
});

describe('TypeScriptPlugin honors ignorePaths', () => {
  let root: string;
  const w = (rel: string, c: string) => fs.outputFile(path.join(root, rel), c);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-ignore-plugin-'));
    await w('src/keep.ts', 'export class KeepMe { v(): number { return 1; } }');
    await w('gen/generated.ts', 'export class GeneratedEntity { a(): void {} }');
  });
  afterEach(() => fs.remove(root));

  // Regression: the provider used to hand these paths to the plugin as
  // `!<abs path>` negation globs, which fast-glob silently drops — every
  // `.gitignore` / `.archguardignore` match was a no-op on the plugin path.
  // They must travel via `ignorePaths` (globby's `ignore` option) instead.
  it('drops files listed in ignorePaths', async () => {
    const plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: root });
    const archJson = await plugin.parseProject(root, {
      workspaceRoot: root,
      excludePatterns: [],
      ignorePaths: [path.join(root, 'gen/generated.ts')],
    });
    const names = (archJson.entities ?? []).map((e) => e.name);
    expect(names).toContain('KeepMe');
    expect(names).not.toContain('GeneratedEntity');
  });
});
