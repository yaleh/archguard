/**
 * Tests for GoPlugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoPlugin } from '../../../src/plugins/golang/index.js';

describe('GoPlugin', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: '/tmp' });
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('golang');
      expect(plugin.metadata.displayName).toBe('Go Architecture Atlas');
      expect(plugin.metadata.version).toBe('6.0.0');
      expect(plugin.metadata.fileExtensions).toContain('.go');
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.typeInference).toBe(true);
    });

    it('should have correct supportedLevels', () => {
      expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
    });

    it('should have dependencyExtraction capability enabled', () => {
      expect(plugin.metadata.capabilities.dependencyExtraction).toBe(true);
    });
  });

  describe('dependencyExtractor', () => {
    it('should expose dependencyExtractor property', () => {
      expect(plugin.dependencyExtractor).toBeDefined();
    });

    it('should have extractDependencies method', () => {
      expect(typeof plugin.dependencyExtractor.extractDependencies).toBe('function');
    });
  });

  describe('canHandle', () => {
    it('should handle .go files', () => {
      expect(plugin.canHandle('main.go')).toBe(true);
      expect(plugin.canHandle('/path/to/file.go')).toBe(true);
    });

    it('should not handle non-Go files', () => {
      expect(plugin.canHandle('main.ts')).toBe(false);
      expect(plugin.canHandle('main.js')).toBe(false);
    });
  });

  describe('parseCode', () => {
    it('should parse simple Go struct', () => {
      const code = `
package main

type User struct {
  Name string
  Age int
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.language).toBe('go');
      expect(result.version).toBe('1.0');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].type).toBe('struct');
      expect(result.entities[0].members).toHaveLength(2);
    });

    it('should parse interface and detect implementation', () => {
      const code = `
package main

type Runner interface {
  Start()
  Stop()
}

type Service struct {
  Name string
}

func (s Service) Start() {
}

func (s Service) Stop() {
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.entities).toHaveLength(2);

      const iface = result.entities.find((e) => e.name === 'Runner');
      expect(iface).toBeDefined();
      expect(iface?.type).toBe('interface');

      const struct = result.entities.find((e) => e.name === 'Service');
      expect(struct).toBeDefined();
      expect(struct?.type).toBe('struct');

      // Check implementation relation
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].type).toBe('implementation');
      expect(result.relations[0].source).toBe('main.Service');
      expect(result.relations[0].target).toBe('main.Runner');
    });

    it('should handle multiple structs and interfaces', () => {
      const code = `
package main

type User struct {
  Name string
}

type Admin struct {
  User User
  Level int
}

type Authenticator interface {
  Login(username string, password string) bool
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.entities).toHaveLength(3);
      expect(result.entities.filter((e) => e.type === 'struct')).toHaveLength(2);
      expect(result.entities.filter((e) => e.type === 'interface')).toHaveLength(1);
    });

    it('should extract field visibility', () => {
      const code = `
package main

type User struct {
  Name string
  age int
}
`;

      const result = plugin.parseCode(code, 'test.go');

      const user = result.entities[0];
      const nameField = user.members.find((m) => m.name === 'Name');
      const ageField = user.members.find((m) => m.name === 'age');

      expect(nameField?.visibility).toBe('public');
      expect(ageField?.visibility).toBe('private');
    });

    it('should extract method information', () => {
      const code = `
package main

type User struct {
  Name string
}

func (u User) GetName() string {
  return u.Name
}
`;

      const result = plugin.parseCode(code, 'test.go');

      const user = result.entities[0];
      const methods = user.members.filter((m) => m.type === 'method');

      expect(methods).toHaveLength(1);
      expect(methods[0].name).toBe('GetName');
      expect(methods[0].returnType).toBe('string');
    });
  });

  describe('initialization', () => {
    it('should require initialization before use', async () => {
      const uninitializedPlugin = new GoPlugin();

      expect(() => {
        uninitializedPlugin.parseCode('package main', 'test.go');
      }).toThrow('GoPlugin not initialized');
    });

    it('should allow multiple initializations', async () => {
      await plugin.initialize({ workspaceRoot: '/tmp' });
      await plugin.initialize({ workspaceRoot: '/tmp' });

      // Should not throw
      const result = plugin.parseCode('package main', 'test.go');
      expect(result.language).toBe('go');
    });
  });

  describe('dispose', () => {
    it('should dispose resources', async () => {
      await plugin.dispose();

      expect(() => {
        plugin.parseCode('package main', 'test.go');
      }).toThrow('GoPlugin not initialized');
    });
  });

  describe('isTestFile', () => {
    it('returns true for _test.go files', () => {
      expect(plugin.isTestFile!('foo_test.go')).toBe(true);
      expect(plugin.isTestFile!('/abs/path/bar_test.go')).toBe(true);
    });

    it('returns false for regular .go files', () => {
      expect(plugin.isTestFile!('foo.go')).toBe(false);
      expect(plugin.isTestFile!('test_helper.go')).toBe(false);
    });

    it('declares testStructureExtraction capability', () => {
      expect(plugin.metadata.capabilities.testStructureExtraction).toBe(true);
    });
  });

  describe('extractTestStructure', () => {
    const testifyFile = `
package mypkg_test

import (
  "testing"
  "github.com/stretchr/testify/assert"
  "github.com/stretchr/testify/require"
)

func TestFoo(t *testing.T) {
  result := doSomething()
  assert.Equal(t, 42, result)
  require.NoError(t, err)
}

func TestBar(t *testing.T) {
  t.Skip("not yet implemented")
  assert.True(t, false)
}
`;

    it('returns null for non-test files', () => {
      expect(plugin.extractTestStructure!('foo.go', 'package main')).toBeNull();
    });

    it('detects testify framework', () => {
      const raw = plugin.extractTestStructure!('foo_test.go', testifyFile);
      expect(raw).not.toBeNull();
      expect(raw!.frameworks).toContain('testify');
      // stdlib 'testing' is omitted when testify is detected (avoid duplicate attribution)
      expect(raw!.frameworks).not.toContain('testing');
    });

    it('falls back to stdlib testing framework when no testify', () => {
      const stdlibCode = `
package mypkg_test
import "testing"
func TestPlain(t *testing.T) {
  t.Error("fail")
}
`;
      const raw = plugin.extractTestStructure!('plain_test.go', stdlibCode);
      expect(raw!.frameworks).toContain('testing');
      expect(raw!.frameworks).not.toContain('testify');
    });

    it('extracts test functions and counts assertions', () => {
      const raw = plugin.extractTestStructure!('foo_test.go', testifyFile);
      expect(raw!.testCases).toHaveLength(2);
      const foo = raw!.testCases.find((c) => c.name === 'TestFoo');
      expect(foo).toBeDefined();
      expect(foo!.assertionCount).toBeGreaterThan(0);
      expect(foo!.isSkipped).toBe(false);
    });

    it('detects skipped tests', () => {
      const raw = plugin.extractTestStructure!('foo_test.go', testifyFile);
      const bar = raw!.testCases.find((c) => c.name === 'TestBar');
      expect(bar!.isSkipped).toBe(true);
    });

    it('marks benchmark files as performance type', () => {
      const benchCode = `
package mypkg_test
import "testing"
func BenchmarkFoo(b *testing.B) {
  for i := 0; i < b.N; i++ { doWork() }
}
`;
      const raw = plugin.extractTestStructure!('bench_test.go', benchCode);
      expect(raw!.testTypeHint).toBe('performance');
    });

    it('returns null when no test functions found', () => {
      const raw = plugin.extractTestStructure!('foo_test.go', 'package mypkg\n\nfunc helper() {}');
      expect(raw).toBeNull();
    });

    it('sets unit testTypeHint for regular Test* functions', () => {
      const raw = plugin.extractTestStructure!('foo_test.go', testifyFile);
      expect(raw!.testTypeHint).toBe('unit');
    });

    // Fix 2A: module-local imports must appear in importedSourceFiles
    it('includes module-local imports in importedSourceFiles when module name is known', async () => {
      const { mkdtemp, writeFile, rm } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const pathMod = await import('path');
      const tmpDir = await mkdtemp(pathMod.default.join(tmpdir(), 'gotest-'));
      try {
        await writeFile(
          pathMod.default.join(tmpDir, 'go.mod'),
          'module github.com/myorg/myapp\n\ngo 1.21\n'
        );
        const localPlugin = new GoPlugin();
        await localPlugin.initialize({ workspaceRoot: tmpDir });

        const code = `
package mypkg_test

import (
  "testing"
  "github.com/myorg/myapp/internal/service"
  "github.com/stretchr/testify/assert"
)

func TestFoo(t *testing.T) {
  assert.Equal(t, 1, 1)
}
`;
        const raw = localPlugin.extractTestStructure!('service_test.go', code);
        expect(raw).not.toBeNull();
        expect(raw!.importedSourceFiles.some((f: string) => f.includes('internal/service'))).toBe(true);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it('does NOT include external github.com packages in importedSourceFiles', async () => {
      const { mkdtemp, writeFile, rm } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const pathMod = await import('path');
      const tmpDir = await mkdtemp(pathMod.default.join(tmpdir(), 'gotest-'));
      try {
        await writeFile(
          pathMod.default.join(tmpDir, 'go.mod'),
          'module github.com/myorg/myapp\n\ngo 1.21\n'
        );
        const localPlugin = new GoPlugin();
        await localPlugin.initialize({ workspaceRoot: tmpDir });

        const code = `
package mypkg_test

import (
  "testing"
  "github.com/stretchr/testify/assert"
  "github.com/some/external/lib"
)

func TestFoo(t *testing.T) {
  assert.Equal(t, 1, 1)
}
`;
        const raw = localPlugin.extractTestStructure!('foo_test.go', code);
        expect(raw).not.toBeNull();
        // testify and external lib must NOT appear
        expect(raw!.importedSourceFiles.some((f: string) => f.includes('testify'))).toBe(false);
        expect(raw!.importedSourceFiles.some((f: string) => f.includes('external/lib'))).toBe(false);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});
