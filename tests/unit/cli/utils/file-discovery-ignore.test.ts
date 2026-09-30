import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';

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
