import { describe, it, expect, beforeEach } from 'vitest';
import { JavaPlugin } from '@/plugins/java/index.js';
import path from 'path';

describe('JavaPlugin', () => {
  let plugin: JavaPlugin;

  beforeEach(async () => {
    plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: process.cwd() });
  });

  describe('Metadata', () => {
    it('should have correct plugin metadata', () => {
      expect(plugin.metadata.name).toBe('java');
      expect(plugin.metadata.displayName).toBe('Java');
      expect(plugin.metadata.fileExtensions).toContain('.java');
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.incrementalParsing).toBe(true);
      expect(plugin.metadata.capabilities.dependencyExtraction).toBe(true);
    });
  });

  describe('canHandle', () => {
    it('should handle .java files', () => {
      expect(plugin.canHandle('User.java')).toBe(true);
      expect(plugin.canHandle('/path/to/User.java')).toBe(true);
    });

    it('should not handle non-Java files', () => {
      expect(plugin.canHandle('User.ts')).toBe(false);
      expect(plugin.canHandle('User.go')).toBe(false);
    });

    it('should handle directories with pom.xml', () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');
      expect(plugin.canHandle(fixturesPath)).toBe(true);
    });
  });

  describe('parseCode', () => {
    it('should parse a simple Java class', () => {
      const code = `
package com.example;

public class User {
  private String name;

  public String getName() {
    return name;
  }
}
      `;

      const result = plugin.parseCode(code, 'User.java');

      expect(result.version).toBe('1.0');
      expect(result.language).toBe('java');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].type).toBe('class');
    });

    it('should parse Java interface', () => {
      const code = `
package com.example;

public interface Service {
  void start();
  void stop();
}
      `;

      const result = plugin.parseCode(code, 'Service.java');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Service');
      expect(result.entities[0].type).toBe('interface');
    });

    it('should parse Java enum', () => {
      const code = `
package com.example;

public enum Status {
  ACTIVE,
  INACTIVE
}
      `;

      const result = plugin.parseCode(code, 'Status.java');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Status');
      expect(result.entities[0].type).toBe('enum');
    });

    it('should detect inheritance relationships', () => {
      const code = `
package com.example;

public class AdminUser extends User implements Service {
}
      `;

      const result = plugin.parseCode(code, 'AdminUser.java');

      expect(result.relations.length).toBeGreaterThan(0);
      const inheritanceRel = result.relations.find(r => r.type === 'inheritance');
      expect(inheritanceRel).toBeDefined();

      const implRel = result.relations.find(r => r.type === 'implementation');
      expect(implRel).toBeDefined();
    });
  });

  describe('parseFiles', () => {
    it('should parse multiple Java files', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');
      const files = [
        path.join(fixturesPath, 'simple-class.java'),
        path.join(fixturesPath, 'interface.java'),
      ];

      const result = await plugin.parseFiles(files);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.sourceFiles).toEqual(files);
    });
  });

  describe('parseProject', () => {
    it('should parse a Java project directory', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.language).toBe('java');
      expect(result.version).toBe('1.0');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid Java code gracefully', () => {
      const code = `
package com.example;

public class Invalid {
  // incomplete
      `;

      expect(() => {
        plugin.parseCode(code, 'Invalid.java');
      }).not.toThrow();
    });

    it('should handle empty code', () => {
      const result = plugin.parseCode('', 'Empty.java');

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('Dependency Extraction', () => {
    it('should extract dependencies from Maven project', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

      if (plugin.dependencyExtractor) {
        const dependencies = await plugin.dependencyExtractor.extractDependencies(fixturesPath);
        expect(dependencies.length).toBeGreaterThan(0);
      }
    });
  });
});
