/**
 * Unit tests for JavaPlugin test-structure and path handling methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { JavaPlugin } from '@/plugins/java/index.js';
import type { ParserBackend } from '@/plugins/shared/parser-backend.js';

function makePlugin(): JavaPlugin {
  return new JavaPlugin({} as ParserBackend);
}

describe('JavaPlugin.isTestFile', () => {
  const plugin = makePlugin();
  it('detects .java test files by directory convention', () => {
    expect(plugin.isTestFile('src/test/java/com/example/Foo.java')).toBe(true);
    expect(plugin.isTestFile('src/test/java/com/example/Foo.java')).toBe(true);
  });
  it('detects naming conventions', () => {
    expect(plugin.isTestFile('src/main/java/FooTest.java')).toBe(true);
    expect(plugin.isTestFile('src/main/java/FooTests.java')).toBe(true);
    expect(plugin.isTestFile('src/main/java/FooIT.java')).toBe(true);
    expect(plugin.isTestFile('src/main/java/FooBenchmark.java')).toBe(true);
    expect(plugin.isTestFile('src/main/java/TestFoo.java')).toBe(true);
  });
  it('rejects non-test classes', () => {
    expect(plugin.isTestFile('src/main/java/UserService.java')).toBe(false);
  });
});

describe('JavaPlugin.extractTestStructure', () => {
  const plugin = makePlugin();
  it('returns null when no test framework is detected', () => {
    expect(plugin.extractTestStructure('Foo.java', 'class Foo {}')).toBeNull();
  });

  it('extracts JUnit5 test cases with assertions', () => {
    const code = [
      'import org.junit.jupiter.api.Test;',
      'import static org.junit.jupiter.api.Assertions.assertEquals;',
      'class CalcTest {',
      '  @Test',
      '  void adds() {',
      '    assertEquals(3, add(1, 2));',
      '  }',
      '  @Test',
      '  void skips() {',
      '    assertTrue(true);',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('CalcTest.java', code);
    expect(result).not.toBeNull();
    expect(result.frameworks).toContain('junit5');
    expect(result.testCases).toHaveLength(2);
    expect(result.testTypeHint).toBe('unit');
    expect(result.testCases[0].assertionCount).toBe(1);
  });

  it('detects skipped tests via @Disabled and TestNG frameworks', () => {
    const code = [
      'import org.testng.annotations.Test;',
      'class SuiteTest {',
      '  @Test',
      '  void works() {}',
      '  @Test',
      '  @Disabled',
      '  void ignored() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('SuiteTest.java', code);
    expect(result.frameworks).toContain('testng');
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[1].isSkipped).toBe(true);
  });

  it('detects JMH benchmarks as performance tests', () => {
    const code = [
      'import org.openjdk.jmh.annotations.Benchmark;',
      'class Bench {',
      '  @Benchmark',
      '  public void run() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('Bench.java', code);
    expect(result.frameworks).toContain('jmh');
    expect(result.testTypeHint).toBe('performance');
  });

  it('extracts project-internal imports and filters external packages', () => {
    const code = [
      'import org.junit.jupiter.api.Test;',
      'import com.example.repo.UserRepo;',
      'import static com.example.util.Helper.build;',
      'import java.util.List;',
      'class FooTest {',
      '  @Test',
      '  void t() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('FooTest.java', code);
    expect(result.importedSourceFiles).toContain('com/example/repo/UserRepo.java');
    expect(result.importedSourceFiles).toContain('com/example/util/Helper.java');
    expect(result.importedSourceFiles.some((f) => f.startsWith('java/'))).toBe(false);
  });
});

describe('JavaPlugin.canHandle', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'java-plugin-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('accepts .java files', () => {
    expect(makePlugin().canHandle('some/Foo.java')).toBe(true);
  });
  it('accepts directories with pom.xml', async () => {
    await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>');
    expect(makePlugin().canHandle(dir)).toBe(true);
  });
  it('accepts directories with build.gradle', async () => {
    await fs.writeFile(path.join(dir, 'build.gradle'), 'plugins {}');
    expect(makePlugin().canHandle(dir)).toBe(true);
  });
  it('rejects non-matching paths', () => {
    expect(makePlugin().canHandle('some/Foo.ts')).toBe(false);
    expect(makePlugin().canHandle('/nonexistent/dir')).toBe(false);
  });
});
