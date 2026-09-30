import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';

describe('symlink-aware file discovery', () => {
  let root: string;
  const body = (n: string) =>
    `export function ${n}(a: number) {\n  const x = a * 2;\n  const y = x + 1;\n  return y - a;\n}\n`;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'symlink-disc-'));
    await fs.outputFile(path.join(root, 'a/one.ts'), body('one'));
    await fs.outputFile(path.join(root, 'b/two.ts'), body('two'));
    await fs.outputFile(path.join(root, 'c/comp.tsx'), 'export class Comp {}\n');
    await fs.outputFile(path.join(root, 'c/plain.js'), 'export class PlainJs {}\n');
    await fs.outputFile(path.join(root, 'c/jsx.jsx'), 'export class JsxC {}\n');
    await fs.outputFile(path.join(root, 'c/skip.mjs'), 'export class Skipped {}\n');
    await fs.outputFile(path.join(root, 'real/inner.ts'), 'export class Inner {}\n');
    await fs.symlink('../a/one.ts', path.join(root, 'b/link.ts'));
    await fs.symlink('real', path.join(root, 'linkdir'));
  });
  afterAll(() => fs.remove(root));

  it('FileDiscoveryService skips symlinks and covers ts/tsx/js/jsx', async () => {
    const files = await new FileDiscoveryService().discoverFiles({ sources: [root] });
    expect(files.some((f) => f.endsWith('link.ts'))).toBe(false);
    expect(files.some((f) => f.includes('linkdir'))).toBe(false);
    for (const n of ['comp.tsx', 'plain.js', 'jsx.jsx', 'one.ts']) {
      expect(files.some((f) => f.endsWith(n))).toBe(true);
    }
    expect(await new FileDiscoveryService().countSkippedByExtension([root])).toBe(1);
  });

  it('plugin parseProject does not re-introduce symlinks and parses js/tsx/jsx', async () => {
    const plugin = new TypeScriptPlugin();
    await plugin.initialize({ workspaceRoot: root });
    const arch = await plugin.parseProject(root, { workspaceRoot: root });
    expect(arch.sourceFiles.filter((f) => fs.lstatSync(f).isSymbolicLink())).toEqual([]);
    expect(arch.sourceFiles.some((f) => f.includes('linkdir'))).toBe(false);
    const names = arch.entities.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(['Comp', 'PlainJs', 'JsxC', 'Inner', 'one', 'two'])
    );
    expect(names).not.toContain('Skipped');
    expect(names.filter((n) => n === 'one')).toHaveLength(1);
    expect(names.filter((n) => n === 'Inner')).toHaveLength(1);
  });
});
