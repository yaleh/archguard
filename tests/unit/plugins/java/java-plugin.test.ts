import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { JavaPlugin } from '@/plugins/java/index.js';

describe('JavaPlugin — parseProject cross-module pom.xml relations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-java-pm-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('emits dependency relation from pom.xml cross-module dep', async () => {
    // Write jlama-core
    const coreDir = path.join(tmpDir, 'jlama-core');
    await fs.ensureDir(path.join(coreDir, 'src/main/java/com/example/core'));
    await fs.writeFile(
      path.join(coreDir, 'pom.xml'),
      '<project><artifactId>jlama-core</artifactId></project>'
    );
    await fs.writeFile(
      path.join(coreDir, 'src/main/java/com/example/core/CoreService.java'),
      'package com.example.core; public class CoreService {}'
    );

    // Write jlama-cli with dep on jlama-core
    const cliDir = path.join(tmpDir, 'jlama-cli');
    await fs.ensureDir(path.join(cliDir, 'src/main/java/com/example/cli'));
    await fs.writeFile(
      path.join(cliDir, 'pom.xml'),
      `<project><artifactId>jlama-cli</artifactId>
       <dependencies>
         <dependency>
           <groupId>com.example</groupId>
           <artifactId>jlama-core</artifactId>
         </dependency>
       </dependencies>
      </project>`
    );
    await fs.writeFile(
      path.join(cliDir, 'src/main/java/com/example/cli/Main.java'),
      'package com.example.cli; public class Main {}'
    );

    const plugin = new JavaPlugin();
    await plugin.initialize({});
    const result = await plugin.parseProject(tmpDir, { excludePatterns: [] });

    const crossModuleDeps = result.relations.filter(
      (r) => r.type === 'dependency' && r.source.includes('cli') && r.target.includes('core')
    );
    expect(crossModuleDeps.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no cross-module relations for a single-module project', async () => {
    // Only one sub-module — no inter-module dependencies possible
    const coreDir = path.join(tmpDir, 'core');
    await fs.ensureDir(path.join(coreDir, 'src/main/java/com/example'));
    await fs.writeFile(
      path.join(coreDir, 'pom.xml'),
      '<project><artifactId>core</artifactId></project>'
    );
    await fs.writeFile(
      path.join(coreDir, 'src/main/java/com/example/Service.java'),
      'package com.example; public class Service {}'
    );

    const plugin = new JavaPlugin();
    await plugin.initialize({});
    const result = await plugin.parseProject(tmpDir, { excludePatterns: [] });

    // No cross-module dependency relations
    const crossModuleDeps = result.relations.filter((r) => r.type === 'dependency');
    expect(crossModuleDeps).toHaveLength(0);
  });
});
