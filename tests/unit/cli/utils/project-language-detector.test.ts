import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  detectPrimaryLanguage,
  detectProjectLanguages,
} from '@/cli/utils/project-language-detector.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.remove(dir);
  }
  tmpDirs.length = 0;
});

async function makeProject(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-lang-detect-'));
  tmpDirs.push(root);
  for (const [file, content] of Object.entries(structure)) {
    const target = path.join(root, file);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content);
  }
  return root;
}

describe('project-language-detector', () => {
  it('prefers cpp for a CMake project with substantial cpp sources', async () => {
    const root = await makeProject({
      'CMakeLists.txt': 'project(example)',
      'src/main.cpp': 'int main() { return 0; }',
      'src/model.cpp': 'class Model {};',
      'src/runner.cpp': 'class Runner {};',
      'src/model.h': 'class Model;',
      'common/util.cpp': 'void util() {}',
      'convert.py': 'print("convert")',
      'tools/server/webui/package.json': '{"name":"webui"}',
      'tools/server/webui/tsconfig.json': '{"compilerOptions":{}}',
      'tools/server/webui/src/app.ts': 'export const x = 1;',
    });

    const candidates = await detectProjectLanguages(root);

    expect(candidates[0]?.language).toBe('cpp');
    expect(candidates.some((candidate) => candidate.language === 'python')).toBe(true);
    expect(candidates.some((candidate) => candidate.language === 'typescript')).toBe(true);
  });

  it('prefers a root-level build language over nested tooling languages', async () => {
    const root = await makeProject({
      'CMakeLists.txt': 'project(example)',
      'src/main.cpp': 'int main() { return 0; }',
      'src/engine.cpp': 'class Engine {};',
      'src/engine.h': 'class Engine;',
      'requirements.txt': 'pytest',
      'convert.py': 'print("convert")',
      'tools/server/webui/package.json': '{"name":"webui"}',
      'tools/server/webui/tsconfig.json': '{"compilerOptions":{}}',
      'tools/server/webui/src/app.ts': 'export const x = 1;',
    });

    const candidates = await detectProjectLanguages(root);

    expect(candidates[0]?.language).toBe('cpp');
    expect(candidates.find((candidate) => candidate.language === 'cpp')?.score).toBeGreaterThan(
      candidates.find((candidate) => candidate.language === 'typescript')?.score ?? 0
    );
  });

  it('falls back to typescript when no strong markers are found', async () => {
    const root = await makeProject({
      'src/index.ts': 'export const app = 1;',
      'src/helper.ts': 'export const helper = 1;',
    });

    const primary = await detectPrimaryLanguage(root);

    expect(primary?.language).toBe('typescript');
  });
});
