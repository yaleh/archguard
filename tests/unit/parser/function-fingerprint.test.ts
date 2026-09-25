import { describe, it, expect } from 'vitest';
import { fingerprintSourceText, type FunctionFingerprint } from '@/parser/function-fingerprint.js';

const fp = (code: string): FunctionFingerprint[] => fingerprintSourceText(code, 'src/x.ts');
const hashOf = (code: string): string => fp(code)[0].hash;

describe('fingerprintSourceText', () => {
  it('gives identical hashes to functions that differ only in local names and literals', () => {
    const a = `function a(items: string[], limit: number) {
      const out = [];
      for (const item of items) { if (item.length > limit) out.push(item.trim() + 'x'); }
      return out;
    }`;
    const b = `function totallyDifferent(list: string[], max: number) {
      // comment
      const result = [];
      for (const entry of list) { if (entry.length > max) result.push(entry.trim() + 'yyy'); }
      return result;
    }`;
    expect(hashOf(a)).toBe(hashOf(b));
  });

  it('gives different hashes to structurally different functions', () => {
    const a = `function a(x) { const y = x + 1; return y; }`;
    const b = `function a(x) { const y = x - 1; return y; }`;
    expect(hashOf(a)).not.toBe(hashOf(b));
  });

  it('keeps called function names and property names', () => {
    const a = `function a(x) { return foo(x.left); }`;
    expect(hashOf(a)).not.toBe(hashOf(`function a(x) { return bar(x.left); }`));
    expect(hashOf(a)).not.toBe(hashOf(`function a(x) { return foo(x.right); }`));
  });

  it('distinguishes literal types but not literal values', () => {
    expect(hashOf(`function f() { return 1; }`)).toBe(hashOf(`function f() { return 2; }`));
    expect(hashOf(`function f() { return 1; }`)).not.toBe(hashOf(`function f() { return 'a'; }`));
  });

  it('distinguishes which parameter is used', () => {
    expect(hashOf(`function f(a, b) { return a; }`)).not.toBe(
      hashOf(`function f(a, b) { return b; }`)
    );
  });

  it('covers nested functions, methods, arrows, function expressions and object-literal methods', () => {
    const code = `
      function outer() {
        function inner() { return 1; }
        return inner;
      }
      class C { m() { return 1; } constructor() { this.x = 1; } get g() { return 1; } }
      const arrow = () => 1;
      const expr = function () { return 1; };
      const obj = { method() { return 1; } };
    `;
    const found = fp(code);
    const byName = Object.fromEntries(found.map((f) => [f.name, f.kind]));
    expect(byName).toMatchObject({
      outer: 'function',
      inner: 'function',
      m: 'method',
      constructor: 'constructor',
      g: 'accessor',
      arrow: 'arrow',
      expr: 'function-expression',
      method: 'method',
    });
  });

  it('skips overload signatures and abstract methods (no body)', () => {
    const code = `
      function f(a: string): void;
      function f(a: number): void;
      function f(a: any) { return a; }
      abstract class A { abstract m(): void; }
    `;
    expect(fp(code)).toHaveLength(1);
  });

  it('records line range, statement and token counts', () => {
    const [f] = fp(`function f() {\n  const a = 1;\n  return a;\n}\n`);
    expect(f).toMatchObject({ startLine: 1, endLine: 4, statementCount: 2, name: 'f' });
    expect(f.tokenCount).toBeGreaterThan(5);
  });

  it('ignores type annotations', () => {
    expect(hashOf(`function f(a: string) { return a; }`)).toBe(
      hashOf(`function f(a: number) { return a; }`)
    );
  });

  it('counts an expression-bodied arrow as one statement', () => {
    expect(fp(`const f = (a) => a + 1;`)[0].statementCount).toBe(1);
  });
});
