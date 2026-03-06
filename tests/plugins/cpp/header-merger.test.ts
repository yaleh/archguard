import { describe, it, expect } from 'vitest';
import { HeaderMerger } from '@/plugins/cpp/builders/header-merger.js';
import type { RawCppFile, RawClass } from '@/plugins/cpp/types.js';

function makeFile(filePath: string, classes: Partial<RawClass>[] = []): RawCppFile {
  return {
    filePath,
    namespace: '',
    classes: classes.map((c) => ({
      name: c.name ?? 'Foo',
      qualifiedName: c.qualifiedName ?? c.name ?? 'Foo',
      kind: c.kind ?? 'class',
      bases: c.bases ?? [],
      fields: c.fields ?? [],
      methods: c.methods ?? [],
      sourceFile: filePath,
      startLine: 1,
      endLine: 10,
      ...c,
    })),
    enums: [],
    functions: [],
    includes: [],
  };
}

describe('HeaderMerger', () => {
  const merger = new HeaderMerger();

  it('merges .hpp declaration with .cpp implementation', () => {
    const header = makeFile('engine/Foo.hpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const impl = makeFile('engine/Foo.cpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const result = merger.merge([header, impl]);
    expect(result).toHaveLength(1);
  });

  it('declarationFile points to the header', () => {
    const header = makeFile('engine/Foo.hpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const impl = makeFile('engine/Foo.cpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const [entity] = merger.merge([header, impl]);
    expect(entity.declarationFile).toBe('engine/Foo.hpp');
    expect(entity.implementationFile).toBe('engine/Foo.cpp');
  });

  it('method list is union, deduped by name', () => {
    const method = (name: string, sourceFile: string) => ({
      name,
      returnType: 'void',
      parameters: [],
      visibility: 'public' as const,
      isVirtual: false,
      isStatic: false,
      isPure: false,
      isConst: false,
      sourceFile,
      startLine: 1,
    });
    const header = makeFile('Foo.hpp', [
      {
        name: 'Foo',
        qualifiedName: 'Foo',
        methods: [method('doWork', 'Foo.hpp'), method('init', 'Foo.hpp')],
      },
    ]);
    const impl = makeFile('Foo.cpp', [
      {
        name: 'Foo',
        qualifiedName: 'Foo',
        methods: [method('doWork', 'Foo.cpp')], // duplicate
      },
    ]);
    const [entity] = merger.merge([header, impl]);
    expect(entity.methods).toHaveLength(2); // doWork + init, no duplicate
  });

  it('ns1::Foo and ns2::Foo are NOT merged', () => {
    const f1 = makeFile('ns1.hpp', [{ name: 'Foo', qualifiedName: 'ns1::Foo' }]);
    const f2 = makeFile('ns2.hpp', [{ name: 'Foo', qualifiedName: 'ns2::Foo' }]);
    const result = merger.merge([f1, f2]);
    expect(result).toHaveLength(2);
  });

  it('impl-only class (no header) is included as-is', () => {
    const impl = makeFile('Foo.cpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const [entity] = merger.merge([impl]);
    expect(entity.declarationFile).toBe('Foo.cpp');
    expect(entity.implementationFile).toBeUndefined();
  });

  it('header-only class has no implementationFile', () => {
    const header = makeFile('Foo.hpp', [{ name: 'Foo', qualifiedName: 'Foo' }]);
    const [entity] = merger.merge([header]);
    expect(entity.declarationFile).toBe('Foo.hpp');
    expect(entity.implementationFile).toBeUndefined();
  });
});
