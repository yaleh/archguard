/**
 * Unit tests for the Java DependencyExtractor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { DependencyExtractor } from '@/plugins/java/dependency-extractor.js';

describe('Java DependencyExtractor', () => {
  let root: string;
  const extractor = new DependencyExtractor();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-dep-'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('returns [] when neither pom.xml nor build.gradle exists', async () => {
    expect(await extractor.extractDependencies(root)).toEqual([]);
  });

  it('parses Maven pom.xml dependencies with scopes', async () => {
    await fs.writeFile(
      path.join(root, 'pom.xml'),
      [
        '<project>',
        '  <dependencies>',
        '    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>31.1-jre</version></dependency>',
        '    <dependency><groupId>org.junit</groupId><artifactId>junit</artifactId><version>4.13</version><scope>test</scope></dependency>',
        '  </dependencies>',
        '</project>',
      ].join('\n'),
      'utf-8'
    );
    const deps = await extractor.extractDependencies(root);
    expect(deps).toHaveLength(2);
    const guava = deps.find((d) => d.name === 'guava');
    expect(guava).toMatchObject({ version: '31.1-jre', type: 'maven', scope: 'runtime', source: 'pom.xml' });
    const junit = deps.find((d) => d.name === 'junit');
    expect(junit?.scope).toBe('development'); // test scope
  });

  it('prefers pom.xml over build.gradle', async () => {
    await fs.writeFile(path.join(root, 'build.gradle'), "implementation 'org.slf4j:slf4j-api:2.0.0'\n", 'utf-8');
    await fs.writeFile(path.join(root, 'pom.xml'), '<project><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>1</version></dependency></dependencies></project>', 'utf-8');
    const deps = await extractor.extractDependencies(root);
    expect(deps.some((d) => d.source === 'pom.xml')).toBe(true);
    expect(deps.some((d) => d.source === 'build.gradle')).toBe(false);
  });

  it('parses Gradle build.gradle with various scopes', async () => {
    await fs.writeFile(
      path.join(root, 'build.gradle'),
      [
        "implementation 'com.google.guava:guava:31.1-jre'",
        "testImplementation 'org.junit.jupiter:junit-jupiter:5.9.0'",
        "compileOnly 'org.projectlombok:lombok:1.18.28'",
      ].join('\n'),
      'utf-8'
    );
    const deps = await extractor.extractDependencies(root);
    expect(deps).toHaveLength(3);
    expect(deps.find((d) => d.name === 'guava')?.scope).toBe('runtime');
    expect(deps.find((d) => d.name === 'junit-jupiter')?.scope).toBe('development');
    expect(deps.find((d) => d.name === 'lombok')?.scope).toBe('optional');
  });
});
