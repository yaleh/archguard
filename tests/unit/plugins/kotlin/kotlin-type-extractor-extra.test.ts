/**
 * TASK-71 — KotlinTypeExtractor branch-dense path extra tests.
 *
 * Fills gaps in kotlin-type-extractor.test.ts for the pure-function branch
 * matrix of `extractTypes`:
 *   - empty / whitespace / bare-nullable input (early-return branch)
 *   - generic outer type that is NOT a primitive/stdlib wrapper (the
 *     "keep outer name" branch — distinct from the unwrap-only wrappers)
 *   - nested generics where inner depth > 1 exercises `splitTypeArgs` depth
 *     counting (comma inside a nested `<…>` is not a split point)
 */
import { describe, it, expect } from 'vitest';
import { KotlinTypeExtractor } from '@/plugins/kotlin/kotlin-type-extractor.js';

describe('KotlinTypeExtractor.extractTypes — early-return / degenerate input', () => {
  const extractor = new KotlinTypeExtractor();

  it('returns [] for empty string', () => {
    expect(extractor.extractTypes('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(extractor.extractTypes('   ')).toEqual([]);
  });

  it('returns [] for bare nullable marker (nothing left after stripping ?)', () => {
    expect(extractor.extractTypes('?')).toEqual([]);
  });
});

describe('KotlinTypeExtractor.extractTypes — generic outer type is custom (non-primitive)', () => {
  const extractor = new KotlinTypeExtractor();

  it('keeps a custom outer type AND extracts inner type', () => {
    // Wrapper is not in KOTLIN_PRIMITIVE_TYPES → both outer and inner surface
    expect(extractor.extractTypes('Wrapper<Order>')).toEqual(['Wrapper', 'Order']);
  });

  it('keeps custom outer with multiple inner types', () => {
    const result = extractor.extractTypes('Repository<Order, User>');
    expect(result).toContain('Repository');
    expect(result).toContain('Order');
    expect(result).toContain('User');
  });

  it('keeps a nullable custom outer type', () => {
    expect(extractor.extractTypes('Wrapper<Order>?')).toEqual(['Wrapper', 'Order']);
  });
});

describe('KotlinTypeExtractor.extractTypes — nested generics / splitTypeArgs depth', () => {
  const extractor = new KotlinTypeExtractor();

  it('recurses through two levels of nested generic arguments', () => {
    // Map<String, Map<Int, Order>> → the comma inside Map<Int, Order>
    // must NOT be treated as a top-level argument split point
    expect(extractor.extractTypes('Map<String, Map<Int, Order>>')).toEqual(['Order']);
  });

  it('surfaces inner custom type from nested primitive wrapper inside custom outer', () => {
    // Wrapper<Map<String, Order>> → custom outer kept + nested Order surfaced
    const result = extractor.extractTypes('Wrapper<Map<String, Order>>');
    expect(result).toContain('Wrapper');
    expect(result).toContain('Order');
  });

  it('extracts multiple comma-separated custom args at top level', () => {
    // Pair<String, User> → String filtered, User surfaced
    expect(extractor.extractTypes('Pair<String, User>')).toEqual(['User']);
  });
});
