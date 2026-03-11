/**
 * Tests for CppPlugin (ILanguagePlugin implementation)
 * Written TDD-first before the implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fs-extra before importing the module under test
vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn(),
  },
}));

// Mock glob before importing the module under test
vi.mock('glob', () => ({
  glob: vi.fn(),
}));

// Mock tree-sitter-bridge to isolate plugin logic from native bindings
vi.mock('@/plugins/cpp/tree-sitter-bridge.js', () => ({
  TreeSitterBridge: vi.fn().mockImplementation(() => ({
    parseCode: vi.fn().mockReturnValue({
      filePath: '/proj/src/foo.cpp',
      namespace: '',
      classes: [
        {
          name: 'Foo',
          qualifiedName: 'Foo',
          kind: 'class' as const,
          bases: [],
          fields: [],
          methods: [],
          sourceFile: '/proj/src/foo.cpp',
          startLine: 1,
          endLine: 10,
        },
      ],
      enums: [],
      functions: [],
      includes: [],
    }),
  })),
}));

// Mock HeaderMerger
vi.mock('@/plugins/cpp/builders/header-merger.js', () => ({
  HeaderMerger: vi.fn().mockImplementation(() => ({
    merge: vi.fn().mockImplementation((rawFiles) =>
      rawFiles.flatMap(
        (f: {
          classes: Array<{
            name: string;
            qualifiedName: string;
            kind: 'class' | 'struct';
            bases: Array<{ name: string; access: 'public' | 'private' | 'protected' }>;
            fields: unknown[];
            methods: unknown[];
            sourceFile: string;
            startLine: number;
            endLine: number;
          }>;
        }) =>
          f.classes.map((cls) => ({
            ...cls,
            declarationFile: f.classes[0]?.sourceFile ?? '',
            implementationFile: undefined,
          }))
      )
    ),
  })),
}));

// Mock ArchJsonMapper
vi.mock('@/plugins/cpp/archjson-mapper.js', () => ({
  ArchJsonMapper: vi.fn().mockImplementation(() => ({
    mapEntities: vi.fn().mockReturnValue([
      {
        id: '.Foo',
        name: 'Foo',
        type: 'class' as const,
        visibility: 'public' as const,
        members: [],
        sourceLocation: { file: '/proj/src/foo.cpp', startLine: 1, endLine: 10 },
      },
    ]),
    mapRelations: vi.fn().mockReturnValue([]),
  })),
}));

// Mock DependencyExtractor
vi.mock('@/plugins/cpp/dependency-extractor.js', () => ({
  DependencyExtractor: vi.fn().mockImplementation(() => ({
    extractDependencies: vi.fn().mockResolvedValue([]),
  })),
}));

import { CppPlugin } from '../../../src/plugins/cpp/index.js';
import fs from 'fs-extra';
import { glob } from 'glob';

const mockedFs = vi.mocked(fs);
const mockedGlob = vi.mocked(glob);

describe('CppPlugin', () => {
  let plugin: CppPlugin;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: glob returns one .cpp file
    mockedGlob.mockResolvedValue(['/proj/src/foo.cpp']);

    // Default: readFile returns simple C++ code
    mockedFs.readFile = vi.fn().mockResolvedValue(`
#include <string>
class Foo {
public:
  std::string name;
};
`);

    plugin = new CppPlugin();
    await plugin.initialize({ workspaceRoot: '/proj' });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  // ------------------------------------------------------------------ metadata
  describe('metadata', () => {
    it('has correct name and displayName', () => {
      expect(plugin.metadata.name).toBe('cpp');
      expect(plugin.metadata.displayName).toBe('C/C++');
    });

    it('lists C++ file extensions', () => {
      const exts = plugin.metadata.fileExtensions;
      expect(exts).toContain('.cpp');
      expect(exts).toContain('.hpp');
      expect(exts).toContain('.h');
    });

    it('declares singleFileParsing and dependencyExtraction capabilities', () => {
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.dependencyExtraction).toBe(true);
    });
  });

  // ------------------------------------------------------------------ supportedLevels
  describe('supportedLevels', () => {
    it('includes package and class', () => {
      expect(plugin.supportedLevels).toContain('package');
      expect(plugin.supportedLevels).toContain('class');
    });
  });

  // ------------------------------------------------------------------ dependencyExtractor
  describe('dependencyExtractor', () => {
    it('is defined (not undefined)', () => {
      expect(plugin.dependencyExtractor).toBeDefined();
    });

    it('has extractDependencies method', () => {
      expect(typeof plugin.dependencyExtractor.extractDependencies).toBe('function');
    });
  });

  // ------------------------------------------------------------------ initialize idempotency
  describe('initialize()', () => {
    it('is idempotent — second call is a no-op', async () => {
      // First initialize already called in beforeEach.
      // Call again and ensure parseCode is not called for that reason.
      await plugin.initialize({ workspaceRoot: '/proj' });
      await plugin.initialize({ workspaceRoot: '/proj' });

      // Parse a project — should work fine (not throw or double-initialize)
      const result = await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: [],
      });
      expect(result.language).toBe('cpp');
    });

    it('throws when not initialized', async () => {
      const fresh = new CppPlugin();
      expect(() => fresh.parseCode('class A {};', 'a.cpp')).toThrow('CppPlugin not initialized');
    });
  });

  // ------------------------------------------------------------------ canHandle
  describe('canHandle()', () => {
    it('returns true for .cpp extension', () => {
      expect(plugin.canHandle('main.cpp')).toBe(true);
    });

    it('returns true for .hpp extension', () => {
      expect(plugin.canHandle('types.hpp')).toBe(true);
    });

    it('returns true for .cxx extension', () => {
      expect(plugin.canHandle('engine.cxx')).toBe(true);
    });

    it('returns true for .cc extension', () => {
      expect(plugin.canHandle('util.cc')).toBe(true);
    });

    it('returns true for .h extension', () => {
      expect(plugin.canHandle('header.h')).toBe(true);
    });

    it('returns true for .hxx extension', () => {
      expect(plugin.canHandle('something.hxx')).toBe(true);
    });

    it('returns false for .ts extension', () => {
      expect(plugin.canHandle('index.ts')).toBe(false);
    });

    it('returns false for .go extension', () => {
      expect(plugin.canHandle('main.go')).toBe(false);
    });

    it('returns false for .py extension', () => {
      expect(plugin.canHandle('script.py')).toBe(false);
    });

    it('returns true for directory containing CMakeLists.txt', () => {
      mockedFs.existsSync = vi
        .fn()
        .mockImplementation((p: string) => p === '/myproject' || p === '/myproject/CMakeLists.txt');
      mockedFs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      expect(plugin.canHandle('/myproject')).toBe(true);
    });

    it('returns true for directory containing Makefile', () => {
      mockedFs.existsSync = vi
        .fn()
        .mockImplementation((p: string) => p === '/myproject' || p === '/myproject/Makefile');
      mockedFs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      expect(plugin.canHandle('/myproject')).toBe(true);
    });

    it('returns false for directory without CMakeLists.txt or Makefile', () => {
      mockedFs.existsSync = vi.fn().mockImplementation((p: string) => p === '/myproject');
      mockedFs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
      expect(plugin.canHandle('/myproject')).toBe(false);
    });
  });

  // ------------------------------------------------------------------ parseProject
  describe('parseProject()', () => {
    it('returns valid ArchJSON with language cpp', async () => {
      const result = await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: [],
      });

      expect(result.version).toBe('1.0');
      expect(result.language).toBe('cpp');
      expect(typeof result.timestamp).toBe('string');
    });

    it('returns entities from mapper output', async () => {
      const result = await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: [],
      });

      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('includes sourceFiles in result', async () => {
      const result = await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: [],
      });

      expect(result.sourceFiles).toContain('/proj/src/foo.cpp');
    });

    it('filters files matching excludePatterns via glob ignore', async () => {
      // Set glob to return empty (simulating exclude filtered everything out)
      mockedGlob.mockResolvedValue([]);

      const result = await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: ['**/foo.cpp'],
      });

      // With no files, entities should be empty (merger gets empty array)
      expect(result.sourceFiles).toHaveLength(0);
    });

    it('passes excludePatterns into glob ignore list', async () => {
      await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: ['**/generated/**'],
      });

      expect(mockedGlob).toHaveBeenCalledWith(
        expect.stringContaining('cpp'),
        expect.objectContaining({
          ignore: expect.arrayContaining(['**/generated/**']),
        })
      );
    });

    it('always ignores build/ and vendor/ directories', async () => {
      await plugin.parseProject('/proj', {
        workspaceRoot: '/proj',
        excludePatterns: [],
      });

      expect(mockedGlob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ignore: expect.arrayContaining(['**/build/**', '**/vendor/**']),
        })
      );
    });
  });

  // ------------------------------------------------------------------ parseCode
  describe('parseCode()', () => {
    it('returns valid ArchJSON for single file', () => {
      const result = plugin.parseCode('class Bar {};', '/proj/src/bar.cpp');

      expect(result.version).toBe('1.0');
      expect(result.language).toBe('cpp');
      expect(result.sourceFiles).toContain('/proj/src/bar.cpp');
    });

    it('uses default filePath when not provided', () => {
      const result = plugin.parseCode('class Baz {};');
      expect(result.sourceFiles).toContain('source.cpp');
    });

    it('returns entities from mapper', () => {
      const result = plugin.parseCode('class Qux {};', '/proj/src/qux.cpp');
      expect(result.entities.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ dispose
  describe('dispose()', () => {
    it('resets initialized state so parseCode throws after dispose', async () => {
      await plugin.dispose();
      expect(() => plugin.parseCode('class A {};')).toThrow('CppPlugin not initialized');
    });

    it('can be called multiple times without error', async () => {
      await plugin.dispose();
      await expect(plugin.dispose()).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------- isTestFile
  describe('isTestFile()', () => {
    it('returns true for test-*.cpp files', () => {
      expect(plugin.isTestFile!('tests/test-grammar-parser.cpp')).toBe(true);
      expect(plugin.isTestFile!('/abs/tests/test-alloc.cpp')).toBe(true);
    });

    it('returns true for *_test.cpp files', () => {
      expect(plugin.isTestFile!('src/foo_test.cpp')).toBe(true);
    });

    it('returns true for files inside tests/ directory', () => {
      expect(plugin.isTestFile!('/proj/tests/helper.cpp')).toBe(true);
      expect(plugin.isTestFile!('/proj/test/runner.cpp')).toBe(true);
    });

    it('returns false for regular source files', () => {
      expect(plugin.isTestFile!('src/llama.cpp')).toBe(false);
      expect(plugin.isTestFile!('common/utils.h')).toBe(false);
    });

    it('returns false for header-only files', () => {
      expect(plugin.isTestFile!('tests/test-helper.h')).toBe(false);
    });

    it('declares testStructureExtraction capability', () => {
      expect(plugin.metadata.capabilities.testStructureExtraction).toBe(true);
    });
  });

  // -------------------------------------------------------- extractTestStructure
  describe('extractTestStructure()', () => {
    const assertCode = `
#include "llama.h"
#include <cassert>

static void verify_parsing(const char * s) {
  assert(s != nullptr);
  assert(strlen(s) > 0);
}

static void test_basic() {
  verify_parsing("hello");
  assert(1 == 1);
}

int main() {
  test_basic();
  return 0;
}
`;

    const gtestCode = `
#include <gtest/gtest.h>

TEST(FooSuite, BasicTest) {
  EXPECT_EQ(1, 1);
  ASSERT_TRUE(true);
}

TEST_F(FooFixture, AdvancedTest) {
  EXPECT_GT(2, 1);
}
`;

    const catch2Code = `
#define CATCH_CONFIG_MAIN
#include "catch.hpp"

TEST_CASE("basic math") {
  REQUIRE(1 + 1 == 2);
  CHECK(2 * 2 == 4);
}

SCENARIO("scenario test") {
  REQUIRE(true);
}
`;

    it('returns null for non-test files', () => {
      expect(plugin.extractTestStructure!('src/foo.cpp', 'class Foo {};')).toBeNull();
    });

    it('detects assert-based framework', () => {
      const raw = plugin.extractTestStructure!('tests/test-basic.cpp', assertCode);
      expect(raw).not.toBeNull();
      expect(raw!.frameworks).toContain('assert');
    });

    it('extracts named test/verify functions as test cases', () => {
      const raw = plugin.extractTestStructure!('tests/test-basic.cpp', assertCode);
      expect(raw!.testCases.length).toBeGreaterThanOrEqual(2);
      const names = raw!.testCases.map((c) => c.name);
      expect(names).toContain('verify_parsing');
      expect(names).toContain('test_basic');
    });

    it('counts assert() calls as assertions', () => {
      const raw = plugin.extractTestStructure!('tests/test-basic.cpp', assertCode);
      const total = raw!.testCases.reduce((s, c) => s + c.assertionCount, 0);
      expect(total).toBeGreaterThan(0);
    });

    it('detects gtest framework and TEST() macros', () => {
      const raw = plugin.extractTestStructure!('tests/test-foo.cpp', gtestCode);
      expect(raw!.frameworks).toContain('gtest');
      expect(raw!.testCases).toHaveLength(2);
      const names = raw!.testCases.map((c) => c.name);
      expect(names).toContain('BasicTest');
      expect(names).toContain('AdvancedTest');
    });

    it('counts EXPECT_* and ASSERT_* as gtest assertions', () => {
      const raw = plugin.extractTestStructure!('tests/test-foo.cpp', gtestCode);
      const total = raw!.testCases.reduce((s, c) => s + c.assertionCount, 0);
      expect(total).toBeGreaterThan(0);
    });

    it('detects catch2 and extracts TEST_CASE / SCENARIO', () => {
      const raw = plugin.extractTestStructure!('tests/test-catch.cpp', catch2Code);
      expect(raw!.frameworks).toContain('catch2');
      expect(raw!.testCases).toHaveLength(2);
    });

    it('marks benchmark files as performance type', () => {
      const raw = plugin.extractTestStructure!('tests/test-bench-ops.cpp', assertCode);
      expect(raw!.testTypeHint).toBe('performance');
    });

    it('returns unit testTypeHint for regular test files', () => {
      const raw = plugin.extractTestStructure!('tests/test-grammar.cpp', assertCode);
      expect(raw!.testTypeHint).toBe('unit');
    });

    it('extracts local #include paths for coverage linking', () => {
      const raw = plugin.extractTestStructure!('tests/test-basic.cpp', assertCode);
      expect(raw!.importedSourceFiles).toContain('llama.h');
    });

    it('returns null when no test functions or main() found', () => {
      const raw = plugin.extractTestStructure!('tests/test-empty.cpp', '#include <stdio.h>\n');
      expect(raw).toBeNull();
    });
  });
});
