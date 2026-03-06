import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterBridge } from '@/plugins/cpp/tree-sitter-bridge.js';

describe('TreeSitterBridge', () => {
  let bridge: TreeSitterBridge;
  beforeEach(() => {
    bridge = new TreeSitterBridge();
  });

  describe('class extraction', () => {
    it('extracts a simple class', () => {
      const result = bridge.parseCode('class Foo {};', 'test.hpp');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('Foo');
      expect(result.classes[0].kind).toBe('class');
    });

    it('extracts a struct', () => {
      const result = bridge.parseCode('struct Bar {};', 'test.hpp');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].kind).toBe('struct');
    });

    it('extracts single inheritance', () => {
      const result = bridge.parseCode('class B : public A {};', 'test.hpp');
      expect(result.classes[0].bases).toHaveLength(1);
      expect(result.classes[0].bases[0].name).toBe('A');
      expect(result.classes[0].bases[0].access).toBe('public');
    });

    it('extracts multiple inheritance', () => {
      const result = bridge.parseCode('class C : public A, protected B {};', 'test.hpp');
      expect(result.classes[0].bases).toHaveLength(2);
      expect(result.classes[0].bases[1].access).toBe('protected');
    });

    it('sets qualifiedName with namespace prefix', () => {
      const code = 'namespace engine { class Renderer {}; }';
      const result = bridge.parseCode(code, 'test.hpp');
      expect(result.classes[0].qualifiedName).toBe('engine::Renderer');
    });

    it('sets empty namespace for global-scope class', () => {
      const result = bridge.parseCode('class Foo {};', 'test.hpp');
      expect(result.namespace).toBe('');
      expect(result.classes[0].qualifiedName).toBe('Foo');
    });
  });

  describe('enum extraction', () => {
    it('extracts a plain enum', () => {
      const result = bridge.parseCode('enum Color { Red, Green, Blue };', 'test.hpp');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Color');
      expect(result.enums[0].isScoped).toBe(false);
    });

    it('extracts a scoped enum class', () => {
      const result = bridge.parseCode('enum class Direction { Up, Down };', 'test.hpp');
      expect(result.enums[0].isScoped).toBe(true);
    });

    it('stores filePath (not AST dump) as sourceFile', () => {
      const code = `enum Color { Red, Green, Blue };`;
      const result = bridge.parseCode(code, '/my/project/colors.h');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].sourceFile).toBe('/my/project/colors.h');
      expect(result.enums[0].sourceFile).not.toContain('('); // not AST dump
    });
  });

  describe('include extraction', () => {
    it('collects quoted includes', () => {
      const result = bridge.parseCode('#include "engine/core.h"\nclass Foo {};', 'test.cpp');
      expect(result.includes).toContain('engine/core.h');
    });

    it('collects angle-bracket includes', () => {
      const result = bridge.parseCode('#include <vector>', 'test.cpp');
      expect(result.includes).toContain('vector');
    });

    it('does NOT produce Relation entries (includes are not relations)', () => {
      const result = bridge.parseCode('#include "foo.h"\nclass Foo {};', 'test.cpp');
      // RawCppFile has no relations field — includes are in includes[]
      expect(result.includes).toHaveLength(1);
      expect('relations' in result).toBe(false);
    });
  });

  describe('function extraction', () => {
    it('extracts top-level free function', () => {
      const result = bridge.parseCode('void doWork(int x) {}', 'test.cpp');
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('doWork');
    });
  });

  describe('preprocessor conditional handling', () => {
    it('extracts class inside #ifndef include guard', () => {
      const code = `#ifndef MY_HEADER_H
#define MY_HEADER_H
class MyClass {
  void method();
};
#endif`;
      const result = bridge.parseCode(code, 'my_header.h');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('MyClass');
    });

    it('extracts struct inside #if defined conditional', () => {
      const code = `#if defined(__linux__)
struct LinuxFeatures {
  bool has_avx = false;
};
#endif`;
      const result = bridge.parseCode(code, 'feats.cpp');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('LinuxFeatures');
      expect(result.classes[0].kind).toBe('struct');
    });

    it('extracts enum inside include guard', () => {
      const code = `#ifndef COLOR_H
#define COLOR_H
enum class Color { Red, Green, Blue };
#endif`;
      const result = bridge.parseCode(code, 'color.h');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('Color');
    });

    it('extracts function inside #ifdef block', () => {
      const code = `#ifdef ENABLE_FEATURE
void featureFunc() {}
#endif`;
      const result = bridge.parseCode(code, 'feature.cpp');
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('featureFunc');
    });

    it('skips partial template specializations (avoids double angle-bracket name)', () => {
      const code = `
template<typename T, typename B, typename Enable = void>
struct vectorized_binary {};

template<typename T, typename B>
struct vectorized_binary<T, B, void> {};
`;
      const result = bridge.parseCode(code, 'test.h');
      // Only the primary template should be extracted, not the specialization
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toMatch(/^vectorized_binary</);
    });

    it('extracts class from #else branch', () => {
      const code = `#ifdef PLATFORM_A
struct PlatformA {};
#else
struct PlatformB {};
#endif`;
      const result = bridge.parseCode(code, 'platform.h');
      expect(result.classes).toHaveLength(2);
    });
  });
});
