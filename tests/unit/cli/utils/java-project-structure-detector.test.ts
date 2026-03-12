import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { detectJavaProjectStructure } from '@/cli/utils/java-project-structure-detector.js';

async function makeTempProject(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-java-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(root, rel);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content);
  }
  return root;
}

describe('detectJavaProjectStructure', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await fs.remove(root);
      root = '';
    }
  });

  it('returns root diagrams plus one class diagram per Maven module with Java files', async () => {
    root = await makeTempProject({
      'pom.xml': `
        <project>
          <modules>
            <module>jlama-core</module>
            <module>jlama-cli</module>
          </modules>
        </project>
      `,
      'jlama-core/src/main/java/com/acme/CoreApp.java': 'package com.acme; class CoreApp {}',
      'jlama-cli/src/test/java/com/acme/CliTest.java': 'package com.acme; class CliTest {}',
    });

    const result = await detectJavaProjectStructure(root, {
      label: 'Jlama',
    });

    expect(result).toEqual([
      {
        name: 'Jlama/overview/package',
        sources: [root],
        level: 'package',
        language: 'java',
      },
      {
        name: 'Jlama/class/all-classes',
        sources: [root],
        level: 'class',
        language: 'java',
        queryRole: 'primary',
      },
      {
        name: 'Jlama/class/jlama-cli',
        sources: [path.join(root, 'jlama-cli')],
        level: 'class',
        language: 'java',
      },
      {
        name: 'Jlama/class/jlama-core',
        sources: [path.join(root, 'jlama-core')],
        level: 'class',
        language: 'java',
      },
    ]);
  });

  it('ignores missing or non-Java modules from the root pom', async () => {
    root = await makeTempProject({
      'pom.xml': `
        <project>
          <modules>
            <module>jlama-core</module>
            <module>docs</module>
            <module>missing-module</module>
          </modules>
        </project>
      `,
      'jlama-core/src/main/java/com/acme/CoreApp.java': 'package com.acme; class CoreApp {}',
      'docs/README.md': '# docs',
    });

    const result = await detectJavaProjectStructure(root, {
      label: 'Jlama',
    });

    expect(result.map((diagram) => diagram.name)).toEqual([
      'Jlama/overview/package',
      'Jlama/class/all-classes',
      'Jlama/class/jlama-core',
    ]);
  });

  it('passes format and exclude through to every diagram', async () => {
    root = await makeTempProject({
      'pom.xml': `
        <project>
          <modules>
            <module>jlama-core</module>
          </modules>
        </project>
      `,
      'jlama-core/src/main/java/com/acme/CoreApp.java': 'package com.acme; class CoreApp {}',
    });

    const result = await detectJavaProjectStructure(root, {
      label: 'Jlama',
      format: 'json',
      exclude: ['**/generated/**'],
    });

    expect(result.every((diagram) => diagram.language === 'java')).toBe(true);
    expect(result.every((diagram) => diagram.format === 'json')).toBe(true);
    expect(result.every((diagram) => diagram.exclude?.[0] === '**/generated/**')).toBe(true);
  });

  it('falls back to root package/class diagrams when no Maven modules are declared', async () => {
    root = await makeTempProject({
      'pom.xml': '<project />',
      'src/main/java/com/acme/App.java': 'package com.acme; class App {}',
    });

    const result = await detectJavaProjectStructure(root, {
      label: 'solo-app',
    });

    expect(result).toEqual([
      {
        name: 'solo-app/overview/package',
        sources: [root],
        level: 'package',
        language: 'java',
      },
      {
        name: 'solo-app/class/all-classes',
        sources: [root],
        level: 'class',
        language: 'java',
        queryRole: 'primary',
      },
    ]);
  });
});
