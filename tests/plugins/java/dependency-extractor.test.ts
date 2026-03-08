import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DependencyExtractor } from '@/plugins/java/dependency-extractor.js';
import path from 'path';
import fs from 'fs-extra';

describe('JavaDependencyExtractor', () => {
  let extractor: DependencyExtractor;
  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');
  let tempDir: string;

  beforeEach(async () => {
    extractor = new DependencyExtractor();
    tempDir = path.join(process.cwd(), 'test-temp-java-deps');
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('Maven Dependencies', () => {
    it('should extract dependencies from pom.xml', async () => {
      const pomPath = path.join(fixturesPath, 'pom.xml');
      const dependencies = await extractor.extractFromMaven(pomPath);

      expect(dependencies.length).toBeGreaterThan(0);

      const springDep = dependencies.find((d) => d.name === 'spring-boot-starter');
      expect(springDep).toBeDefined();
      expect(springDep?.version).toBe('3.2.0');
      expect(springDep?.scope).toBe('runtime');
      expect(springDep?.source).toBe('pom.xml');
    });

    it('should extract test dependencies from pom.xml', async () => {
      const pomPath = path.join(fixturesPath, 'pom.xml');
      const dependencies = await extractor.extractFromMaven(pomPath);

      const junitDep = dependencies.find((d) => d.name === 'junit');
      expect(junitDep).toBeDefined();
      expect(junitDep?.scope).toBe('development');
    });

    it('should extract runtime dependencies from pom.xml', async () => {
      const pomPath = path.join(fixturesPath, 'pom.xml');
      const dependencies = await extractor.extractFromMaven(pomPath);

      const slf4jDep = dependencies.find((d) => d.name === 'slf4j-api');
      expect(slf4jDep).toBeDefined();
      expect(slf4jDep?.scope).toBe('runtime');
    });

    it('should handle missing pom.xml gracefully', async () => {
      const pomPath = path.join(fixturesPath, 'nonexistent-pom.xml');
      const dependencies = await extractor.extractFromMaven(pomPath);

      expect(dependencies).toEqual([]);
    });
  });

  describe('Gradle Dependencies', () => {
    it('should extract dependencies from build.gradle', async () => {
      const gradlePath = path.join(fixturesPath, 'build.gradle');
      const dependencies = await extractor.extractFromGradle(gradlePath);

      expect(dependencies.length).toBeGreaterThan(0);

      const springDep = dependencies.find((d) => d.name.includes('spring-boot-starter'));
      expect(springDep).toBeDefined();
      expect(springDep?.source).toBe('build.gradle');
    });

    it('should map implementation scope correctly', async () => {
      const gradlePath = path.join(fixturesPath, 'build.gradle');
      const dependencies = await extractor.extractFromGradle(gradlePath);

      const springDep = dependencies.find((d) => d.name.includes('spring-boot-starter'));
      expect(springDep?.scope).toBe('runtime');
    });

    it('should map testImplementation scope correctly', async () => {
      const gradlePath = path.join(fixturesPath, 'build.gradle');
      const dependencies = await extractor.extractFromGradle(gradlePath);

      const junitDep = dependencies.find((d) => d.name.includes('junit'));
      expect(junitDep?.scope).toBe('development');
    });

    it('should map runtimeOnly scope correctly', async () => {
      const gradlePath = path.join(fixturesPath, 'build.gradle');
      const dependencies = await extractor.extractFromGradle(gradlePath);

      const slf4jDep = dependencies.find((d) => d.name.includes('slf4j-api'));
      expect(slf4jDep?.scope).toBe('runtime');
    });

    it('should handle missing build.gradle gracefully', async () => {
      const gradlePath = path.join(fixturesPath, 'nonexistent-build.gradle');
      const dependencies = await extractor.extractFromGradle(gradlePath);

      expect(dependencies).toEqual([]);
    });
  });

  describe('Auto-detection', () => {
    it('should auto-detect Maven project', async () => {
      const dependencies = await extractor.extractDependencies(fixturesPath);

      expect(dependencies.length).toBeGreaterThan(0);
    });

    it('prefers pom.xml when both pom.xml and build.gradle exist', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pom.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>temp-project</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>from-maven</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`
      );
      await fs.writeFile(
        path.join(tempDir, 'build.gradle'),
        `dependencies {
  implementation 'org.example:from-gradle:2.0.0'
}`
      );

      const dependencies = await extractor.extractDependencies(tempDir);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0].name).toBe('from-maven');
      expect(dependencies[0].source).toBe('pom.xml');
    });
  });
});
