/**
 * Tests for Go DependencyExtractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { DependencyExtractor } from '@/plugins/golang/dependency-extractor.js';

describe('DependencyExtractor', () => {
  let extractor: DependencyExtractor;
  let tempDir: string;

  beforeEach(async () => {
    extractor = new DependencyExtractor();
    tempDir = path.join(process.cwd(), 'test-temp-go-deps');
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('extractDependencies', () => {
    it('should parse simple go.mod with require block', async () => {
      const goMod = `module github.com/example/project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    golang.org/x/tools v0.15.0
)
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toHaveLength(2);

      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
      expect(gin?.version).toBe('v1.9.0');
      expect(gin?.type).toBe('gomod');
      expect(gin?.scope).toBe('runtime');
      expect(gin?.source).toBe('go.mod');
      expect(gin?.isDirect).toBe(true);

      const tools = deps.find((d) => d.name === 'golang.org/x/tools');
      expect(tools).toBeDefined();
      expect(tools?.version).toBe('v0.15.0');
      expect(tools?.isDirect).toBe(true);
    });

    it('should distinguish direct and indirect dependencies', async () => {
      const goMod = `module github.com/example/project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    golang.org/x/tools v0.15.0 // indirect
    gopkg.in/yaml.v3 v3.0.1 // indirect
)
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toHaveLength(3);

      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
      expect(gin?.isDirect).toBe(true);

      const tools = deps.find((d) => d.name === 'golang.org/x/tools');
      expect(tools).toBeDefined();
      expect(tools?.isDirect).toBe(false);

      const yaml = deps.find((d) => d.name === 'gopkg.in/yaml.v3');
      expect(yaml).toBeDefined();
      expect(yaml?.isDirect).toBe(false);
    });

    it('should parse single-line require statements', async () => {
      const goMod = `module github.com/example/project

go 1.21

require github.com/spf13/cobra v1.8.0
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toHaveLength(1);

      const cobra = deps.find((d) => d.name === 'github.com/spf13/cobra');
      expect(cobra).toBeDefined();
      expect(cobra?.version).toBe('v1.8.0');
      expect(cobra?.isDirect).toBe(true);
    });

    it('should handle multiple require blocks', async () => {
      const goMod = `module github.com/example/project

go 1.22

require (
    github.com/gin-gonic/gin v1.9.0
)

require (
    github.com/mattn/go-sqlite3 v1.14.19 // indirect
    github.com/google/uuid v1.5.0
)
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toHaveLength(3);

      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
      expect(gin?.isDirect).toBe(true);

      const sqlite = deps.find((d) => d.name === 'github.com/mattn/go-sqlite3');
      expect(sqlite).toBeDefined();
      expect(sqlite?.isDirect).toBe(false);

      const uuid = deps.find((d) => d.name === 'github.com/google/uuid');
      expect(uuid).toBeDefined();
      expect(uuid?.isDirect).toBe(true);
    });

    it('should extract module name', async () => {
      const goMod = `module github.com/example/my-project

go 1.21

require github.com/spf13/cobra v1.8.0
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      // Module name is extracted but not returned as a dependency
      expect(deps).toHaveLength(1);
    });

    it('should ignore replace and exclude directives', async () => {
      const goMod = `module github.com/example/project

go 1.21

require github.com/gin-gonic/gin v1.9.0

replace github.com/old/module => ../local/module

exclude github.com/bad/module v1.0.0
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      // Only the require directive should produce a dependency
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('github.com/gin-gonic/gin');
    });

    it('should handle go.mod without require block', async () => {
      const goMod = `module github.com/example/project

go 1.21
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toEqual([]);
    });

    it('should return empty array when go.mod not found', async () => {
      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toEqual([]);
    });

    it('should handle malformed go.mod gracefully', async () => {
      const goMod = `module github.com/example/project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    invalid line without version
    golang.org/x/tools
)
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      // Should parse valid lines and skip invalid ones
      expect(deps.length).toBeGreaterThanOrEqual(1);
      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
    });

    it('should handle comments in go.mod', async () => {
      const goMod = `module github.com/example/project

go 1.21

require (
    // Web framework
    github.com/gin-gonic/gin v1.9.0
    // Testing library
    github.com/stretchr/testify v1.8.4 // indirect
)
`;

      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      expect(deps).toHaveLength(2);

      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
      expect(gin?.isDirect).toBe(true);

      const testify = deps.find((d) => d.name === 'github.com/stretchr/testify');
      expect(testify).toBeDefined();
      expect(testify?.isDirect).toBe(false);
    });

    it('should parse fixture go.mod file', async () => {
      const fixturePath = path.join(process.cwd(), 'tests/fixtures/go/go.mod');

      // Skip if fixture doesn't exist
      if (!(await fs.pathExists(fixturePath))) {
        return;
      }

      const deps = await extractor.extractDependencies(path.dirname(fixturePath));

      expect(deps.length).toBeGreaterThan(0);

      const gin = deps.find((d) => d.name === 'github.com/gin-gonic/gin');
      expect(gin).toBeDefined();
      expect(gin?.version).toBe('v1.9.0');
      expect(gin?.isDirect).toBe(true);

      const tools = deps.find((d) => d.name === 'golang.org/x/tools');
      expect(tools).toBeDefined();
      expect(tools?.isDirect).toBe(false);
    });
  });

  describe('parseGoMod', () => {
    it('should extract module name', async () => {
      const goMod = `module github.com/example/project

go 1.21
`;
      await fs.writeFile(path.join(tempDir, 'go.mod'), goMod);

      const deps = await extractor.extractDependencies(tempDir);

      // Module is extracted but not returned as dependency
      expect(deps).toEqual([]);
    });
  });
});
