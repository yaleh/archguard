import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { planDefaultScopes } from '@/cli/utils/default-scope-planner.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.remove(dir);
  }
  tmpDirs.length = 0;
});

async function makeProject(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-scope-planner-'));
  tmpDirs.push(root);
  for (const [file, content] of Object.entries(structure)) {
    const target = path.join(root, file);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content);
  }
  return root;
}

describe('planDefaultScopes', () => {
  it('Go scope root uses detected go.mod dir, not project root', async () => {
    // Simulates a TS project with a Go fixture in tests/ (like archguard itself)
    const root = await makeProject({
      'package.json': '{"name":"myapp"}',
      'tsconfig.json': '{"compilerOptions":{}}',
      'src/index.ts': 'export const app = 1;',
      'src/parser.ts': 'export const parse = () => {};',
      'tests/fixtures/go/go.mod': 'module example.com/fixture\ngo 1.21\n',
      'tests/fixtures/go/main.go': 'package main\nfunc main() {}',
    });

    const scopes = await planDefaultScopes(root);
    const goScope = scopes.find((s) => s.language === 'go');

    expect(goScope).toBeDefined();
    // Go scope should use the fixture dir where go.mod is, not the project root
    expect(goScope!.sources[0]).toContain('tests/fixtures/go');
    expect(goScope!.sources[0]).not.toBe('.');
  });

  it('Go scope uses project root when go.mod is at root', async () => {
    const root = await makeProject({
      'go.mod': 'module example.com/app\ngo 1.21\n',
      'main.go': 'package main\nfunc main() {}',
      'pkg/server.go': 'package pkg\nfunc Serve() {}',
    });

    const scopes = await planDefaultScopes(root);
    const goScope = scopes.find((s) => s.language === 'go');

    expect(goScope).toBeDefined();
    expect(goScope!.sources[0]).toBe('.');
  });

  it('TypeScript primary scope uses project root (.)', async () => {
    const root = await makeProject({
      'package.json': '{"name":"myapp"}',
      'tsconfig.json': '{"compilerOptions":{}}',
      'src/index.ts': 'export const app = 1;',
    });

    const scopes = await planDefaultScopes(root);
    const tsScope = scopes.find((s) => s.language === 'typescript');

    expect(tsScope).toBeDefined();
    expect(tsScope!.sources[0]).toBe('.');
  });
});
