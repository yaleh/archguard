import { describe, it, expect, beforeEach } from 'vitest';
import { JavaPlugin } from '@/plugins/java/index.js';
import path from 'path';
import fs from 'fs-extra';

describe('JavaPlugin Integration Tests', () => {
  let plugin: JavaPlugin;
  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

  beforeEach(async () => {
    plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: process.cwd() });
  });

  describe('End-to-End Java Parsing', () => {
    it('should parse complete Java project with multiple files', async () => {
      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      // Verify basic structure
      expect(result.version).toBe('1.0');
      expect(result.language).toBe('java');
      expect(result.entities.length).toBeGreaterThan(0);

      // Check for expected entities from fixtures
      const userClass = result.entities.find(e => e.name === 'User');
      expect(userClass).toBeDefined();
      expect(userClass?.type).toBe('class');

      const serviceInterface = result.entities.find(e => e.name === 'Service');
      expect(serviceInterface).toBeDefined();
      expect(serviceInterface?.type).toBe('interface');

      const statusEnum = result.entities.find(e => e.name === 'Status');
      expect(statusEnum).toBeDefined();
      expect(statusEnum?.type).toBe('enum');
    });

    it('should detect inheritance relationships across files', async () => {
      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      // Find AdminUser class
      const adminUser = result.entities.find(e => e.name === 'AdminUser');
      expect(adminUser).toBeDefined();

      // Check inheritance relations
      const inheritanceRels = result.relations.filter(
        r => r.source === 'com.example.AdminUser' && r.type === 'inheritance'
      );
      expect(inheritanceRels.length).toBeGreaterThan(0);

      // Check implementation relations
      const implRels = result.relations.filter(
        r => r.source === 'com.example.AdminUser' && r.type === 'implementation'
      );
      expect(implRels.length).toBeGreaterThan(0);
    });

    it('should preserve annotations correctly', async () => {
      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      const legacyService = result.entities.find(e => e.name === 'LegacyService');
      expect(legacyService).toBeDefined();
      expect(legacyService?.decorators).toBeDefined();
      expect(legacyService?.decorators?.length).toBeGreaterThan(0);
      expect(legacyService?.decorators?.[0].name).toBe('Deprecated');
    });

    it('should handle enum values correctly', async () => {
      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      const statusEnum = result.entities.find(e => e.name === 'Status');
      expect(statusEnum).toBeDefined();
      expect(statusEnum?.type).toBe('enum');
      expect(statusEnum?.members.length).toBe(4);

      const enumValues = statusEnum?.members.map(m => m.name);
      expect(enumValues).toContain('ACTIVE');
      expect(enumValues).toContain('INACTIVE');
      expect(enumValues).toContain('PENDING');
      expect(enumValues).toContain('DELETED');
    });
  });

  describe('parseCode Integration', () => {
    it('should parse real Java code from fixtures', async () => {
      const userFile = path.join(fixturesPath, 'simple-class.java');
      const code = await fs.readFile(userFile, 'utf-8');

      const result = plugin.parseCode(code, userFile);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].members.length).toBeGreaterThan(0);
    });

    it('should handle complex inheritance hierarchy', async () => {
      const inheritanceFile = path.join(fixturesPath, 'inheritance.java');
      const code = await fs.readFile(inheritanceFile, 'utf-8');

      const result = plugin.parseCode(code, inheritanceFile);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('AdminUser');
      expect(result.relations.length).toBeGreaterThan(0);
    });
  });

  describe('parseFiles Integration', () => {
    it('should parse multiple related files correctly', async () => {
      const files = [
        path.join(fixturesPath, 'simple-class.java'),
        path.join(fixturesPath, 'interface.java'),
        path.join(fixturesPath, 'inheritance.java'),
      ];

      const result = await plugin.parseFiles(files);

      expect(result.entities.length).toBe(3);
      expect(result.sourceFiles).toEqual(files);

      // Verify all entities are present
      const entityNames = result.entities.map(e => e.name);
      expect(entityNames).toContain('User');
      expect(entityNames).toContain('Service');
      expect(entityNames).toContain('AdminUser');
    });
  });

  describe('Dependency Extraction Integration', () => {
    it('should extract Maven dependencies from real pom.xml', async () => {
      if (!plugin.dependencyExtractor) {
        throw new Error('Dependency extractor not available');
      }

      const dependencies = await plugin.dependencyExtractor.extractDependencies(fixturesPath);

      expect(dependencies.length).toBeGreaterThan(0);

      // Verify specific dependencies
      const springBoot = dependencies.find(d => d.name.includes('spring-boot-starter'));
      expect(springBoot).toBeDefined();

      const junit = dependencies.find(d => d.name === 'junit');
      expect(junit).toBeDefined();
      expect(junit?.scope).toBe('development');
    });

    it('should extract Gradle dependencies from real build.gradle', async () => {
      if (!plugin.dependencyExtractor) {
        throw new Error('Dependency extractor not available');
      }

      // For Gradle-specific test, we can check if build.gradle exists
      const gradlePath = path.join(fixturesPath, 'build.gradle');
      if (await fs.pathExists(gradlePath)) {
        const depExtractor = plugin.dependencyExtractor as any;
        const dependencies = await depExtractor.extractDependencies(fixturesPath);

        expect(dependencies.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle missing files gracefully', async () => {
      const nonExistentPath = path.join(fixturesPath, 'nonexistent');

      const result = await plugin.parseProject(nonExistentPath, {
        workspaceRoot: nonExistentPath,
        excludePatterns: [],
      });

      // Should return empty result, not throw
      expect(result.entities).toEqual([]);
    });

    it('should continue parsing when one file has syntax errors', async () => {
      const validFile = path.join(fixturesPath, 'simple-class.java');

      // Create a temporary invalid file
      const tempDir = path.join(process.cwd(), 'temp-test-java');
      await fs.ensureDir(tempDir);

      try {
        const invalidFile = path.join(tempDir, 'invalid.java');
        await fs.writeFile(invalidFile, 'public class Invalid { // incomplete');

        const validCode = await fs.readFile(validFile, 'utf-8');
        await fs.writeFile(path.join(tempDir, 'valid.java'), validCode);

        const result = await plugin.parseProject(tempDir, {
          workspaceRoot: tempDir,
          excludePatterns: [],
        });

        // Should still parse the valid file
        expect(result.entities.length).toBeGreaterThan(0);
      } finally {
        // Cleanup
        await fs.remove(tempDir);
      }
    });
  });

  describe('Performance', () => {
    it('should parse fixtures directory within reasonable time', async () => {
      const startTime = Date.now();

      await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      const duration = Date.now() - startTime;

      // Should complete in less than 5 seconds for small project
      expect(duration).toBeLessThan(5000);
    });
  });
});
