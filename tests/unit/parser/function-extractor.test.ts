import { describe, it, expect } from 'vitest';
import { FunctionExtractor } from '../../../src/parser/function-extractor.js';
import { Project } from 'ts-morph';

describe('FunctionExtractor', () => {
  function extractFromCode(code: string, filePath = 'src/cli/foo.ts') {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
    const sourceFile = project.createSourceFile(filePath, code, { overwrite: true });
    const extractor = new FunctionExtractor();
    return extractor.extract(sourceFile, filePath);
  }

  it('extracts an exported named function declaration', () => {
    const entities = extractFromCode('export function foo(a: string): void {}');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.foo');
    expect(entities[0].name).toBe('foo');
    expect(entities[0].type).toBe('function');
    expect(entities[0].visibility).toBe('public');
  });

  it('extracts an exported arrow function const', () => {
    const entities = extractFromCode('export const bar = (x: number): number => x * 2;');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.bar');
    expect(entities[0].name).toBe('bar');
    expect(entities[0].type).toBe('function');
  });

  it('extracts an exported function expression const', () => {
    const entities = extractFromCode(
      'export const baz = function(y: string): string { return y; };'
    );
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.baz');
    expect(entities[0].type).toBe('function');
  });

  it('does not extract unexported function declarations', () => {
    const entities = extractFromCode('function internal(): void {}');
    expect(entities).toHaveLength(0);
  });

  it('does not extract unexported const arrow functions', () => {
    const entities = extractFromCode('const hidden = (): void => {};');
    expect(entities).toHaveLength(0);
  });

  it('extracts only exported functions from a mixed file', () => {
    const code = `
      export function publicFn(): void {}
      function privateFn(): void {}
      export const publicArrow = () => {};
      const privateArrow = () => {};
    `;
    const entities = extractFromCode(code);
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.name)).toContain('publicFn');
    expect(entities.map((e) => e.name)).toContain('publicArrow');
  });

  it('extracts function parameters as members', () => {
    const entities = extractFromCode(
      'export function greet(name: string, age: number): string { return name; }'
    );
    expect(entities[0].members).toHaveLength(2);
    expect(entities[0].members[0].name).toBe('name');
    expect(entities[0].members[1].name).toBe('age');
  });

  it('includes sourceLocation with correct file and line numbers', () => {
    const entities = extractFromCode('export function foo(): void {}', 'src/cli/commands.ts');
    expect(entities[0].sourceLocation.file).toBe('src/cli/commands.ts');
    expect(entities[0].sourceLocation.startLine).toBeGreaterThanOrEqual(1);
  });
});
