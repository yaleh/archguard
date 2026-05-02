import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { detectKotlinProjectStructure } from '@/cli/utils/kotlin-project-structure-detector.js';

async function makeTempProject(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-kotlin-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(root, rel);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content);
  }
  return root;
}

describe('detectKotlinProjectStructure', () => {
  let root = '';

  afterEach(async () => {
    if (root) {
      await fs.remove(root);
      root = '';
    }
  });

  it('returns exactly 2 diagrams when no settings.gradle.kts is present', async () => {
    root = await makeTempProject({
      'src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'MyApp' });

    expect(result).toEqual([
      {
        name: 'MyApp/overview/package',
        sources: [root],
        level: 'package',
        language: 'kotlin',
      },
      {
        name: 'MyApp/class/all-classes',
        sources: [root],
        level: 'class',
        language: 'kotlin',
        queryRole: 'primary',
      },
    ]);
  });

  it('returns root diagrams plus one class diagram per Gradle module with Kotlin files', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `
        rootProject.name = "myapp"
        include(":app")
        include(":core")
      `,
      'app/src/main/kotlin/com/acme/MainActivity.kt': 'package com.acme\nclass MainActivity',
      'core/src/main/kotlin/com/acme/CoreUtil.kt': 'package com.acme\nclass CoreUtil',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'MyApp' });

    expect(result).toEqual([
      {
        name: 'MyApp/overview/package',
        sources: [root],
        level: 'package',
        language: 'kotlin',
      },
      {
        name: 'MyApp/class/all-classes',
        sources: [root],
        level: 'class',
        language: 'kotlin',
        queryRole: 'primary',
      },
      {
        name: 'MyApp/class/app',
        sources: [path.join(root, 'app')],
        level: 'class',
        language: 'kotlin',
      },
      {
        name: 'MyApp/class/core',
        sources: [path.join(root, 'core')],
        level: 'class',
        language: 'kotlin',
      },
    ]);
  });

  it('ignores modules whose directories contain no .kt files', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `
        include(":app")
        include(":docs")
        include(":missing-module")
      `,
      'app/src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
      'docs/README.md': '# docs',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'MyApp' });

    expect(result.map((d) => d.name)).toEqual([
      'MyApp/overview/package',
      'MyApp/class/all-classes',
      'MyApp/class/app',
    ]);
  });

  it('uses path.basename(projectRoot) as label when options.label is omitted', async () => {
    root = await makeTempProject({
      'src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
    });

    const result = await detectKotlinProjectStructure(root);

    const expectedLabel = path.basename(root);
    expect(result[0].name).toBe(`${expectedLabel}/overview/package`);
    expect(result[1].name).toBe(`${expectedLabel}/class/all-classes`);
  });

  it('handles nested module paths like :core:network', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `
        include(":core:network")
        include(":core:database")
      `,
      'core/network/src/main/kotlin/com/acme/NetworkClient.kt':
        'package com.acme\nclass NetworkClient',
      'core/database/src/main/kotlin/com/acme/Db.kt': 'package com.acme\nclass Db',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'Modular' });

    expect(result.map((d) => d.name)).toEqual([
      'Modular/overview/package',
      'Modular/class/all-classes',
      'Modular/class/core/database',
      'Modular/class/core/network',
    ]);
    expect(result[2].sources).toEqual([path.join(root, 'core/database')]);
    expect(result[3].sources).toEqual([path.join(root, 'core/network')]);
  });

  it('passes format and exclude through to every diagram', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `
        include(":app")
      `,
      'app/src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
    });

    const result = await detectKotlinProjectStructure(root, {
      label: 'MyApp',
      format: 'json',
      exclude: ['**/generated/**'],
    });

    expect(result.every((d) => d.language === 'kotlin')).toBe(true);
    expect(result.every((d) => d.format === 'json')).toBe(true);
    expect(result.every((d) => d.exclude?.[0] === '**/generated/**')).toBe(true);
  });

  it('deduplicates modules listed multiple times in settings.gradle.kts', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `
        include(":app")
        include(":app")
        include(":core")
      `,
      'app/src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
      'core/src/main/kotlin/com/acme/Core.kt': 'package com.acme\nclass Core',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'MyApp' });

    const appDiagrams = result.filter((d) => d.name === 'MyApp/class/app');
    expect(appDiagrams).toHaveLength(1);
  });

  it('level field is correct for all produced diagrams', async () => {
    root = await makeTempProject({
      'settings.gradle.kts': `include(":app")`,
      'app/src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
    });

    const result = await detectKotlinProjectStructure(root, { label: 'MyApp' });

    expect(result[0].level).toBe('package');
    expect(result[1].level).toBe('class');
    expect(result[2].level).toBe('class');
  });

  it('falls back to root-only diagrams when settings.gradle.kts is unreadable', async () => {
    root = await makeTempProject({
      'src/main/kotlin/com/acme/App.kt': 'package com.acme\nclass App',
    });
    // No settings.gradle.kts created — simulates read failure

    const result = await detectKotlinProjectStructure(root, { label: 'Fallback' });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Fallback/overview/package');
    expect(result[1].name).toBe('Fallback/class/all-classes');
  });
});
