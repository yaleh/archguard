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

  it('detects kotlin for a project with build.gradle.kts marker', async () => {
    const root = await makeProject({
      'build.gradle.kts': 'plugins { id("com.android.application") }',
      'settings.gradle.kts': 'rootProject.name = "myapp"',
      'app/src/main/java/com/example/app/MainActivity.kt': 'class MainActivity',
      'app/src/main/java/com/example/app/ViewModel.kt': 'class ViewModel',
      'app/src/main/java/com/example/app/Repository.kt': 'class Repository',
    });

    const primary = await detectPrimaryLanguage(root);

    expect(primary?.language).toBe('kotlin');
  });

  it('prefers kotlin over java when build.gradle.kts coexists with .kt files', async () => {
    const root = await makeProject({
      'build.gradle.kts': 'plugins { kotlin("android") }',
      'pom.xml': '<project></project>',
      'app/src/main/java/com/example/Main.kt': 'fun main() {}',
      'app/src/main/java/com/example/Helper.kt': 'class Helper',
    });

    const candidates = await detectProjectLanguages(root);
    const kotlinCandidate = candidates.find((c) => c.language === 'kotlin');
    const javaCandidate = candidates.find((c) => c.language === 'java');

    expect(kotlinCandidate).toBeDefined();
    expect(kotlinCandidate!.score).toBeGreaterThan(javaCandidate?.score ?? 0);
  });
});
