import { describe, it, expect } from 'vitest';

/**
 * Fix B: C++ assertion patterns for custom testing frameworks.
 *
 * llama.cpp uses tests/testing.h with:
 *   - t.assert_equal(msg, expected, actual)
 *   - t.assert_true(msg, cond)
 * and static helpers:
 *   - assert_equals(expected, actual)
 *   - assert_equal(expected, actual)
 *
 * Previous patterns only matched assert( and GGML_ASSERT( — not these.
 */

async function extractTestStructure(filePath: string, code: string) {
  const { CppPlugin } = await import('@/plugins/cpp/index.js');
  const plugin = new CppPlugin();
  return (plugin as any).extractTestStructure(filePath, code);
}

function totalAssertions(result: any): number {
  return (result?.testCases ?? []).reduce(
    (sum: number, tc: any) => sum + (tc.assertionCount ?? 0),
    0
  );
}

describe('CppPlugin extractTestStructure — custom assertion framework (Fix B)', () => {
  it('assert_equal( is counted as assertion', async () => {
    const code = `#include <cassert>
int main() {
  assert_equal(actual, expected);
  assert_equal(a, b);
}`;
    const r = await extractTestStructure('/tests/test-sampling.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(2);
  });

  it('assert_true( is counted as assertion', async () => {
    const code = `int main() {
  assert_true(condition);
  assert_true(x > 0);
}`;
    const r = await extractTestStructure('/tests/test-foo.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(2);
  });

  it('assert_equals( is counted as assertion', async () => {
    const code = `int main() { assert_equals(a, b); }`;
    const r = await extractTestStructure('/tests/test-bar.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(1);
  });

  it('t.assert_equal( is counted as assertion', async () => {
    const code = `static void run(test_case *t) {
  t.assert_equal("msg", result, expected);
  t.assert_equal(a, b);
}
int main() {}`;
    const r = await extractTestStructure('/tests/test-sampling.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(2);
  });

  it('t.assert_true( is counted as assertion', async () => {
    const code = `static void run(test_case *t) { t.assert_true(v > 0); }
int main() {}`;
    const r = await extractTestStructure('/tests/test-thing.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(1);
  });

  it('mixed assert( and assert_equal( both counted', async () => {
    const code = `int main() {
  assert(condition);
  assert_equal(a, b);
  assert_true(flag);
}`;
    const r = await extractTestStructure('/tests/test-mixed.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThanOrEqual(3);
  });

  it('file with only assert_equal( has assertionCount > 0 (not debug)', async () => {
    const code = `int main() { assert_equal(1, 1); }`;
    const r = await extractTestStructure('/tests/test-only-custom.cpp', code);
    expect(totalAssertions(r)).toBeGreaterThan(0);
  });
});

describe('CppPlugin extractTestStructure — assertion count preserved across many test functions (Fix rounding)', () => {
  // Regression: 4 assert() calls across 9 test functions → Math.round(4/9)=0 per case
  // → summed to 0 → misclassified as debug. totalAssertions must be preserved.
  it('4 assertions / 9 test functions: total assertionCount is 4, not 0', async () => {
    const code = `
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
static bool match_string(const std::string & s) { return s.size() > 0; }
static void test(const std::string & desc, bool b) { assert(b); }
static void test_grammar(const std::string & d, const std::string & g) { test(d + g, true); }
static void test_schema(const std::string & d) { test_grammar(d, "{}"); }
static void test_simple_grammar() { test_grammar("simple", "root ::= [a-z]+"); }
static void test_complex_grammar() { test_grammar("complex", "root ::= [a-z]+"); }
static void test_special_chars() { test_grammar("special", "root ::= [a-z]+"); }
static void test_quantifiers() { test_grammar("quant", "root ::= [a-z]+"); }
static void test_json_schema() { test_schema("json"); }
static void test_sampler_chain() {
  assert(true);
  assert(false || true);
  assert(1 == 1);
}
int main() {
  test_simple_grammar(); test_complex_grammar(); test_special_chars();
  test_quantifiers(); test_json_schema(); test_sampler_chain();
  return 0;
}`;
    const r = await extractTestStructure('/tests/test-grammar-llguidance.cpp', code);
    // 1 assert in test() + 3 in test_sampler_chain() = 4 total
    // With old Math.round(4/9)=0 each → sum 0; with fix: remainder dist → sum 4
    expect(totalAssertions(r)).toBe(4);
  });

  it('totalAssertions field on RawTestFile equals the raw assert() count', async () => {
    const code = `
#include <cassert>
static void test_a() {}
static void test_b() {}
static void test_c() {}
int main() { assert(1); assert(2); }`;
    const r = await extractTestStructure('/tests/test-something.cpp', code);
    // totalAssertions field should be set on the returned object
    expect(r?.totalAssertions).toBe(2);
  });

  it('file with 1 assertion across 5 test functions: total is 1, not 0', async () => {
    const code = `
#include <cassert>
static void test_a() {}
static void test_b() {}
static void test_c() {}
static void test_d() {}
static void test_e() { assert(true); }
int main() {}`;
    const r = await extractTestStructure('/tests/test-one-assert.cpp', code);
    expect(totalAssertions(r)).toBe(1);
  });

  it('file with 0 assertions stays 0 (no false positives)', async () => {
    const code = `
static void test_a() {}
static void test_b() {}
int main() {}`;
    const r = await extractTestStructure('/tests/test-zero.cpp', code);
    expect(totalAssertions(r)).toBe(0);
  });
});
