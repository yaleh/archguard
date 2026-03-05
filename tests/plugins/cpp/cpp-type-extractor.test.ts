import { describe, it, expect } from 'vitest';
import { CppTypeExtractor } from '@/plugins/cpp/cpp-type-extractor.js';

describe('CppTypeExtractor', () => {
  const ex = new CppTypeExtractor();

  describe('extractTypes', () => {
    it('returns [] for empty string', () => {
      expect(ex.extractTypes('')).toEqual([]);
    });

    it('returns [] for primitive types', () => {
      expect(ex.extractTypes('int')).toEqual([]);
      expect(ex.extractTypes('float')).toEqual([]);
      expect(ex.extractTypes('bool')).toEqual([]);
      expect(ex.extractTypes('void')).toEqual([]);
      expect(ex.extractTypes('size_t')).toEqual([]);
      expect(ex.extractTypes('uint32_t')).toEqual([]);
    });

    it('returns [] for STL leaf types', () => {
      expect(ex.extractTypes('std::string')).toEqual([]);
      expect(ex.extractTypes('std::mutex')).toEqual([]);
      expect(ex.extractTypes('std::thread')).toEqual([]);
    });

    it('returns [] for single-letter template params', () => {
      expect(ex.extractTypes('T')).toEqual([]);
      expect(ex.extractTypes('K')).toEqual([]);
      expect(ex.extractTypes('V')).toEqual([]);
    });

    it('extracts plain user-defined type', () => {
      expect(ex.extractTypes('MyClass')).toEqual(['MyClass']);
    });

    it('strips leading const qualifier', () => {
      expect(ex.extractTypes('const MyClass')).toEqual(['MyClass']);
    });

    it('strips trailing pointer', () => {
      expect(ex.extractTypes('MyClass*')).toEqual(['MyClass']);
    });

    it('strips trailing reference', () => {
      expect(ex.extractTypes('MyClass&')).toEqual(['MyClass']);
    });

    it('strips trailing const ref: const MyClass&', () => {
      expect(ex.extractTypes('const MyClass&')).toEqual(['MyClass']);
    });

    it('strips trailing rvalue ref: MyClass&&', () => {
      expect(ex.extractTypes('MyClass&&')).toEqual(['MyClass']);
    });

    it('extracts type from unique_ptr', () => {
      expect(ex.extractTypes('std::unique_ptr<Foo>')).toEqual(['Foo']);
    });

    it('extracts type from shared_ptr', () => {
      expect(ex.extractTypes('std::shared_ptr<Bar>')).toEqual(['Bar']);
    });

    it('extracts type from weak_ptr', () => {
      expect(ex.extractTypes('std::weak_ptr<Baz>')).toEqual(['Baz']);
    });

    it('extracts element type from vector', () => {
      expect(ex.extractTypes('std::vector<MyClass>')).toEqual(['MyClass']);
    });

    it('extracts element type from list', () => {
      expect(ex.extractTypes('std::list<Node>')).toEqual(['Node']);
    });

    it('extracts value type from map (last arg)', () => {
      expect(ex.extractTypes('std::map<std::string, Config>')).toEqual(['Config']);
    });

    it('extracts value type from unordered_map (last arg)', () => {
      expect(ex.extractTypes('std::unordered_map<int, Widget>')).toEqual(['Widget']);
    });

    it('extracts from optional', () => {
      expect(ex.extractTypes('std::optional<Token>')).toEqual(['Token']);
    });

    it('returns [] when vector element is primitive', () => {
      expect(ex.extractTypes('std::vector<int>')).toEqual([]);
    });

    it('returns [] when map value is string', () => {
      expect(ex.extractTypes('std::map<int, std::string>')).toEqual([]);
    });

    it('extracts nested smart ptr: unique_ptr<vector<Node>>', () => {
      expect(ex.extractTypes('std::unique_ptr<std::vector<Node>>')).toEqual(['Node']);
    });

    it('strips leading struct/class keyword', () => {
      expect(ex.extractTypes('struct Point')).toEqual(['Point']);
      expect(ex.extractTypes('class Engine')).toEqual(['Engine']);
    });

    it('returns [] for numeric template arg (array size)', () => {
      expect(ex.extractTypes('std::array<float, 3>')).toEqual([]);
    });

    it('handles unique_ptr without std:: prefix', () => {
      expect(ex.extractTypes('unique_ptr<Engine>')).toEqual(['Engine']);
    });

    it('handles vector without std:: prefix', () => {
      expect(ex.extractTypes('vector<Mesh>')).toEqual(['Mesh']);
    });

    it('extracts from non-std template: MyContainer<Foo>', () => {
      const result = ex.extractTypes('MyContainer<Foo>');
      expect(result).toContain('Foo');
    });
  });

  describe('classifyFieldRelation', () => {
    it('unique_ptr field → composition', () => {
      expect(ex.classifyFieldRelation('std::unique_ptr<Foo>')).toBe('composition');
    });

    it('shared_ptr field → composition', () => {
      expect(ex.classifyFieldRelation('std::shared_ptr<Bar>')).toBe('composition');
    });

    it('weak_ptr field → composition (smart ptr, not raw)', () => {
      expect(ex.classifyFieldRelation('std::weak_ptr<Baz>')).toBe('composition');
    });

    it('raw pointer field → aggregation', () => {
      expect(ex.classifyFieldRelation('MyClass*')).toBe('aggregation');
    });

    it('raw reference field → aggregation', () => {
      expect(ex.classifyFieldRelation('MyClass&')).toBe('aggregation');
    });

    it('value type field → composition', () => {
      expect(ex.classifyFieldRelation('MyClass')).toBe('composition');
    });

    it('const ref → aggregation', () => {
      expect(ex.classifyFieldRelation('const MyClass&')).toBe('aggregation');
    });

    it('vector of values → composition', () => {
      expect(ex.classifyFieldRelation('std::vector<Mesh>')).toBe('composition');
    });

    it('vector of raw pointers → aggregation', () => {
      expect(ex.classifyFieldRelation('std::vector<ggml_tensor*>')).toBe('aggregation');
    });

    it('vector of const raw pointers → aggregation', () => {
      expect(ex.classifyFieldRelation('std::vector<const Node*>')).toBe('aggregation');
    });

    it('vector of unique_ptr → composition', () => {
      expect(ex.classifyFieldRelation('std::vector<std::unique_ptr<Widget>>')).toBe('composition');
    });
  });
});
