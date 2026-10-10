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

  it('preserves assertion total when assertions are fewer than test cases (rounding fix)', () => {
    // 11 assertions across 53 cases: Math.round(11/53)=0 would misclassify as zero-assertion.
    const code = [
      'import org.junit.Test;',
      'import static org.junit.Assert.assertNotNull;',
      'class BoundaryTest {',
      ...Array.from({ length: 53 }, (_, i) => [
        '  @Test',
        `  public void test${i}() {`,
        i % 5 === 0 ? '    assertNotNull(view);' : '',
        '  }',
      ]).flat(),
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('BoundaryTest.java', code);
    expect(result).not.toBeNull();
    expect(result.testCases).toHaveLength(53);
    // File-level total must be preserved (not rounded away).
    expect(result.totalAssertions).toBe(11);
    // At least one case carries an assertion — no longer all zeros.
    const sum = result.testCases.reduce((s, c) => s + c.assertionCount, 0);
    expect(sum).toBe(11);
  });

  it('counts Mockito verify/when assertions (previously missed)', () => {
    const code = [
      'import org.junit.Test;',
      'import static org.mockito.Mockito.verify;',
      'import static org.mockito.Mockito.when;',
      'class ServiceTest {',
      '  @Test',
      '  public void works() {',
      '    when(repo.find(1)).thenReturn(entity);',
      '    verify(repo).save(entity);',
      '    verifyNoMoreInteractions(repo);',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('ServiceTest.java', code);
    expect(result).not.toBeNull();
    // 1 when + 1 verify + 1 verifyNoMoreInteractions
    expect(result.totalAssertions).toBe(3);
  });

  it('applies custom assertion regexes from patternConfig', () => {
    const code = [
      'import org.junit.Test;',
      'class CustomTest {',
      '  @Test',
      '  public void t() {',
      '    myAssert(1, 2);',
      '    myAssert(3, 4);',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('CustomTest.java', code, {
      customAssertionRegexes: ['\\bmyAssert\\s*\\('],
    });
    expect(result).not.toBeNull();
    expect(result.totalAssertions).toBe(2);
  });

  it('does not double-count when custom regex overlaps a default pattern', () => {
    const code = [
      'import org.junit.Test;',
      'import static org.junit.Assert.assertEquals;',
      'class CustomTest {',
      '  @Test',
      '  public void t() {',
      '    assertEquals(1, x);',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('CustomTest.java', code, {
      customAssertionRegexes: ['\\bassertEquals\\s*\\('],
    });
    expect(result).not.toBeNull();
    // assertEquals counted once by default patterns; custom regex is a separate count,
    // mirroring Kotlin/C++ plugin behaviour (custom patterns are additive).
    expect(result.totalAssertions).toBe(2);
  });

  it('infers same-package target FooTest → com.x.Foo', () => {
    const code = [
      'package com.example.calc;',
      'import org.junit.Test;',
      'class CalculatorTest {',
      '  @Test',
      '  public void adds() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/app/src/test/java/com/example/calc/CalculatorTest.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.calc.Calculator');
  });

  it('infers same-package target TestFoo → com.x.Foo', () => {
    const code = [
      'package com.example.util;',
      'import org.junit.Test;',
      'class TestHelper {',
      '  @Test',
      '  public void works() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/app/src/test/java/com/example/util/TestHelper.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.util.Helper');
  });

  it('returns empty samePackageTargets when no package declaration', () => {
    const code = ['import org.junit.Test;', 'class FooTest {', '  @Test', '  void t() {}', '}'].join(
      '\n'
    );
    const result = plugin.extractTestStructure('FooTest.java', code);
    expect(result?.samePackageTargets).toEqual([]);
  });

  it('does not include the test class itself as a target', () => {
    const code = [
      'package com.example;',
      'import org.junit.Test;',
      'class FooTest {',
      '  @Test',
      '  void t() {}',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/app/src/test/java/com/example/FooTest.java',
      code
    );
    expect(result?.samePackageTargets).not.toContain('com.example.FooTest');
    expect(result?.samePackageTargets).toContain('com.example.Foo');
  });

  it('infers same-package targets from direct `new` references', () => {
    const code = [
      'package com.example.bean;',
      'import org.junit.Test;',
      'class BeanBasicDataTest {',
      '  @Test',
      '  public void build() {',
      '    BaseUnitBean base = new BaseUnitBean();',
      '    ConnectionBean conn = new ConnectionBean();',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/fjspray/src/test/java/com/example/bean/BeanBasicDataTest.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.bean.BaseUnitBean');
    expect(result?.samePackageTargets).toContain('com.example.bean.ConnectionBean');
  });

  it('infers same-package targets from static method calls', () => {
    const code = [
      'package com.example.widget;',
      'import org.junit.Test;',
      'class FieldEditCoverageTest {',
      '  @Test',
      '  public void edit() {',
      '    FieldEditView.initEditText(view, 5, true);',
      '    FieldEditView.setErrorHint(FieldEditView.EMPTY_ERROR_TYPE);',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/fjwidget/src/test/java/com/example/widget/FieldEditCoverageTest.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.widget.FieldEditView');
  });

  it('does not infer same-package targets for imported classes', () => {
    // An imported class with the same simple name must not be mis-attributed to
    // the test's package — it resolves via import matching instead.
    const code = [
      'package com.example.bean;',
      'import com.other.ExternalBean;',
      'import org.junit.Test;',
      'class BeanTest {',
      '  @Test',
      '  public void t() {',
      '    ExternalBean b = new ExternalBean();',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/fjspray/src/test/java/com/example/bean/BeanTest.java',
      code
    );
    // ExternalBean is imported → not added as a same-package target.
    expect(result?.samePackageTargets).not.toContain('com.example.bean.ExternalBean');
  });

  it('infers same-package targets from .class literals (reflection tests)', () => {
    const code = [
      'package com.example.jimu;',
      'import org.junit.Test;',
      'import java.lang.reflect.Method;',
      'class InterfaceCoverageTest {',
      '  @Test',
      '  public void methodsExist() {',
      '    Method[] ms = IJimuManager.class.getDeclaredMethods();',
      '    Method[] cs = TrailOptCallback.class.getDeclaredMethods();',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/fjcountarea/src/test/java/com/example/jimu/InterfaceCoverageTest.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.jimu.IJimuManager');
    expect(result?.samePackageTargets).toContain('com.example.jimu.TrailOptCallback');
  });

  it('infers targets from Class.forName fully-qualified literals', () => {
    const code = [
      'package com.example.field;',
      'import org.junit.Test;',
      'class FieldStructureTest {',
      '  @Test',
      '  public void classesExist() throws Exception {',
      '    Class.forName("com.example.field.adapter.PrescriptionAdapter");',
      '    Class.forName("com.example.field.adapter.BoundariesAdapter");',
      '  }',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/repo/app/src/test/java/com/example/field/FieldStructureTest.java',
      code
    );
    expect(result?.samePackageTargets).toContain('com.example.field.adapter.PrescriptionAdapter');
    expect(result?.samePackageTargets).toContain('com.example.field.adapter.BoundariesAdapter');
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
