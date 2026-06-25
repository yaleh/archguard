import { describe, it, expect } from 'vitest';
import {
  KotlinTypeExtractor,
  KOTLIN_PRIMITIVE_TYPES,
} from '@/plugins/kotlin/kotlin-type-extractor.js';

describe('KOTLIN_PRIMITIVE_TYPES', () => {
  it('includes Kotlin built-in types', () => {
    expect(KOTLIN_PRIMITIVE_TYPES.has('String')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('Int')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('Boolean')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('Unit')).toBe(true);
  });

  it('includes collection types', () => {
    expect(KOTLIN_PRIMITIVE_TYPES.has('List')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('Map')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('Set')).toBe(true);
    expect(KOTLIN_PRIMITIVE_TYPES.has('MutableList')).toBe(true);
  });

  it('does not include custom types', () => {
    expect(KOTLIN_PRIMITIVE_TYPES.has('UserRepository')).toBe(false);
    expect(KOTLIN_PRIMITIVE_TYPES.has('ViewModel')).toBe(false);
  });
});

describe('KotlinTypeExtractor.extractTypes', () => {
  const extractor = new KotlinTypeExtractor();

  it('returns custom type unchanged', () => {
    expect(extractor.extractTypes('UserRepository')).toEqual(['UserRepository']);
  });

  it('filters primitive types', () => {
    expect(extractor.extractTypes('String')).toEqual([]);
    expect(extractor.extractTypes('Int')).toEqual([]);
    expect(extractor.extractTypes('Boolean')).toEqual([]);
  });

  it('unwraps generic type and extracts inner type', () => {
    // List<Order> → ['Order']
    expect(extractor.extractTypes('List<Order>')).toEqual(['Order']);
    // Map<String, UserRepository> → ['UserRepository'] (String filtered)
    expect(extractor.extractTypes('Map<String, UserRepository>')).toEqual(['UserRepository']);
  });

  it('strips nullable marker', () => {
    // UserRepository? → ['UserRepository']
    expect(extractor.extractTypes('UserRepository?')).toEqual(['UserRepository']);
  });

  it('handles nested generics', () => {
    // Flow<List<Order>> → ['Order']
    // (Flow is not primitive, but inner type extracted)
    const result = extractor.extractTypes('Flow<List<Order>>');
    expect(result).toContain('Order');
  });

  it('returns empty for pure primitive generic', () => {
    expect(extractor.extractTypes('List<String>')).toEqual([]);
  });
});

describe('KotlinTypeExtractor.classifyFieldRelation', () => {
  const extractor = new KotlinTypeExtractor();

  it('returns composition for any non-null reference', () => {
    expect(extractor.classifyFieldRelation('UserRepository')).toBe('composition');
  });

  it('returns composition for nullable reference', () => {
    expect(extractor.classifyFieldRelation('UserRepository?')).toBe('composition');
  });

  it('returns composition for generic collection with custom type', () => {
    expect(extractor.classifyFieldRelation('List<Order>')).toBe('composition');
  });
});
