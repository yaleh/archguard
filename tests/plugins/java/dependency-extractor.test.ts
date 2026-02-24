import { describe, it, expect } from 'vitest';
import { DependencyExtractor } from '@/plugins/java/dependency-extractor.js';
import path from 'path';

describe('JavaDependencyExtractor', () => {
  const extractor = new DependencyExtractor();
  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

  describe('Maven Dependencies', () => {
    it('should extract dependencies from pom.xml', async () => {
      const pomPath = path.join(fixturesPath, 'pom.xml');
      const dependencies = await extractor.extractFromMaven(pomPath);

      expect(dependencies.length).toBeGreaterThan(0);

      const springDep = dependencies.find((d) => d.name === 'spring-boot-starter');
      expect(springDep).toBeDefined();
      expect(springDep?.version).toBe('3.2.0');
      expect(springDep?.scope).toBe('runtime');
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
      const dependencies = await extractor.extract(fixturesPath);

      expect(dependencies.length).toBeGreaterThan(0);
    });
  });
});
