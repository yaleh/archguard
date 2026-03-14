import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { MavenCrossModuleParser } from '@/plugins/java/maven-crossmodule-parser.js';

describe('MavenCrossModuleParser', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-maven-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writePom(subDir: string, content: string): Promise<void> {
    const dir = path.join(tmpDir, subDir);
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'pom.xml'), content, 'utf-8');
  }

  it('returns one dependency when cli pom declares core as dependency', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <groupId>com.example</groupId>
            <artifactId>core</artifactId>
            <version>1.0</version>
          </dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'cli', to: 'core' });
  });

  it('returns multiple dependencies when cli pom declares core and net', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom('net', `<project><artifactId>net</artifactId></project>`);
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <artifactId>core</artifactId>
          </dependency>
          <dependency>
            <artifactId>net</artifactId>
          </dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ from: 'cli', to: 'core' });
    expect(result).toContainEqual({ from: 'cli', to: 'net' });
  });

  it('excludes test-scoped dependencies', async () => {
    await writePom('net', `<project><artifactId>net</artifactId></project>`);
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <artifactId>net</artifactId>
            <scope>test</scope>
          </dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('includes runtime-scoped dependencies', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <artifactId>core</artifactId>
            <scope>runtime</scope>
          </dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'cli', to: 'core' });
  });

  it('excludes external (non-sub-module) dependencies', async () => {
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
            <version>2.15.0</version>
          </dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('returns all pairs when multiple sub-modules depend on each other', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom(
      'net',
      `
      <project>
        <artifactId>net</artifactId>
        <dependencies>
          <dependency><artifactId>core</artifactId></dependency>
        </dependencies>
      </project>
    `
    );
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency><artifactId>core</artifactId></dependency>
          <dependency><artifactId>net</artifactId></dependency>
        </dependencies>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ from: 'cli', to: 'core' });
    expect(result).toContainEqual({ from: 'cli', to: 'net' });
    expect(result).toContainEqual({ from: 'net', to: 'core' });
  });

  it('does not treat dependencyManagement entries as direct dependencies', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom(
      'cli',
      `
      <project>
        <artifactId>cli</artifactId>
        <dependencyManagement>
          <dependencies>
            <dependency>
              <artifactId>core</artifactId>
              <version>1.0</version>
            </dependency>
          </dependencies>
        </dependencyManagement>
      </project>
    `
    );
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(0);
  });
});
