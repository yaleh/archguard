/**
 * Unit tests for CppPlugin test-structure and path handling methods.
 */

import { describe, it, expect } from 'vitest';
import { CppPlugin } from '@/plugins/cpp/index.js';
import type { ParserBackend } from '@/plugins/shared/parser-backend.js';

function makePlugin(): CppPlugin {
  return new CppPlugin({} as ParserBackend);
}

describe('CppPlugin.isTestFile', () => {
  const plugin = makePlugin();
  it('detects test-* and *_test files', () => {
    expect(plugin.isTestFile('test-foo.cpp')).toBe(true);
    expect(plugin.isTestFile('test_foo.cc')).toBe(true);
    expect(plugin.isTestFile('foo_test.cpp')).toBe(true);
    expect(plugin.isTestFile('FooTest.cpp')).toBe(true);
  });
  it('detects files under tests/ directories', () => {
    expect(plugin.isTestFile('tests/unit/foo.cpp')).toBe(true);
  });
  it('rejects non-test cpp files', () => {
    expect(plugin.isTestFile('src/main.cpp')).toBe(false);
  });
  it('rejects non-cpp files', () => {
    expect(plugin.isTestFile('test-foo.ts')).toBe(false);
  });
});

describe('CppPlugin.extractTestStructure', () => {
  const plugin = makePlugin();
  it('detects gtest framework and test cases', () => {
    const code = [
      '#include <gtest/gtest.h>',
      'TEST(AddTest, AddsNumbers) {',
      '  EXPECT_EQ(3, add(1, 2));',
      '  ASSERT_TRUE(true);',
      '}',
    ].join('\n');
    const result = plugin.extractTestStructure('test-add.cpp', code);
    expect(result).not.toBeNull();
    expect(result!.frameworks).toContain('gtest');
    expect(result!.testCases.length).toBeGreaterThan(0);
    expect(result!.testCases[0].assertionCount).toBeGreaterThan(0);
  });

  it('detects catch2 framework', () => {
    const code = ['#include <catch2/catch_test_macros.hpp>', 'TEST_CASE("x") {', '  REQUIRE(1 == 1);', '}'].join('\n');
    const result = plugin.extractTestStructure('test-x.cpp', code);
    expect(result!.frameworks).toContain('catch2');
  });

  it('falls back to assert framework', () => {
    const code = ['void test_foo() {', '  assert(1 == 1);', '}'].join('\n');
    const result = plugin.extractTestStructure('test_foo.cpp', code);
    expect(result!.frameworks).toContain('assert');
  });

  it('returns null for non-test files', () => {
    expect(plugin.extractTestStructure('src/main.cpp', 'int main() {}')).toBeNull();
  });
});
