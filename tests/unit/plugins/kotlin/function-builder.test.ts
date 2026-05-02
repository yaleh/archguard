/**
 * Unit tests for FunctionBuilder — top-level Kotlin function extraction.
 *
 * Uses real tree-sitter-kotlin parsing via inline Kotlin source strings.
 * Tests cover: visibility, @Composable detection, parameters, return types,
 * multiple annotations, and zero-parameter functions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FunctionBuilder } from '@/plugins/kotlin/builders/function-builder.js';

let parse: (code: string) => any;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Parser = require('tree-sitter');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const KotlinLanguage = require('@tree-sitter-grammars/tree-sitter-kotlin');
  const p = new Parser();
  p.setLanguage(KotlinLanguage);
  parse = (code: string) => p.parse(code).rootNode;
});

describe('FunctionBuilder.extractTopLevelFunctions', () => {
  it('plain fun — isComposable: false, visibility: public', () => {
    const builder = new FunctionBuilder();
    const code = `package com.example\nfun topLevel() {}`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example', 'TopLevel.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.name).toBe('topLevel');
    expect(fn.isComposable).toBe(false);
    expect(fn.visibility).toBe('public');
    expect(fn.paramTypes).toEqual([]);
    expect(fn.decorators).toEqual([]);
    expect(fn.packageName).toBe('com.example');
    expect(fn.filePath).toBe('TopLevel.kt');
  });

  it('@Composable fun Screen(modifier: Modifier) — isComposable: true, paramTypes: [Modifier]', () => {
    const builder = new FunctionBuilder();
    const code = `package com.example.ui\n\n@Composable\nfun Screen(modifier: Modifier) {}`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example.ui', 'Screen.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.name).toBe('Screen');
    expect(fn.isComposable).toBe(true);
    expect(fn.paramTypes).toEqual(['Modifier']);
    expect(fn.decorators).toContain('Composable');
    expect(fn.visibility).toBe('public');
  });

  it('private fun helper(): String — visibility: private, returnType: String', () => {
    const builder = new FunctionBuilder();
    const code = `package com.example\n\nprivate fun helper(): String { return "" }`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example', 'Helper.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.name).toBe('helper');
    expect(fn.visibility).toBe('private');
    expect(fn.returnType).toBe('String');
    expect(fn.isComposable).toBe(false);
  });

  it('internal fun doWork(repo: UserRepository): Boolean — visibility: internal, paramTypes, returnType', () => {
    const builder = new FunctionBuilder();
    const code = `package com.example\n\ninternal fun doWork(repo: UserRepository): Boolean { return true }`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example', 'Worker.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.name).toBe('doWork');
    expect(fn.visibility).toBe('internal');
    expect(fn.paramTypes).toEqual(['UserRepository']);
    expect(fn.returnType).toBe('Boolean');
  });

  it('@Composable @Preview fun PreviewScreen() — isComposable: true, decorators contain both', () => {
    const builder = new FunctionBuilder();
    const code = `package com.example.ui\n\n@Composable\n@Preview\nfun PreviewScreen() {}`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example.ui', 'PreviewScreen.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.isComposable).toBe(true);
    expect(fn.decorators).toContain('Composable');
    expect(fn.decorators).toContain('Preview');
    expect(fn.paramTypes).toEqual([]);
  });

  it('fun noParams() — paramTypes is empty array', () => {
    const builder = new FunctionBuilder();
    const code = `fun noParams() {}`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, '', 'NoParams.kt');

    expect(fns).toHaveLength(1);
    const fn = fns[0];
    expect(fn.paramTypes).toEqual([]);
    expect(fn.returnType).toBeUndefined();
  });

  it('multiple top-level functions are all extracted', () => {
    const builder = new FunctionBuilder();
    const code = `
package com.example

fun alpha() {}
fun beta(): Int { return 1 }
@Composable
fun gamma(x: String) {}
`.trim();
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example', 'Multi.kt');

    expect(fns).toHaveLength(3);
    expect(fns.map((f) => f.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(fns[1].returnType).toBe('Int');
    expect(fns[2].isComposable).toBe(true);
    expect(fns[2].paramTypes).toEqual(['String']);
  });

  it('class methods are NOT extracted as top-level functions', () => {
    const builder = new FunctionBuilder();
    const code = `
package com.example

fun topLevel() {}

class MyClass {
    fun classMethod() {}
}
`.trim();
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, 'com.example', 'Mixed.kt');

    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('topLevel');
  });

  it('startLine and endLine are set (1-based)', () => {
    const builder = new FunctionBuilder();
    const code = `fun simple() {}`;
    const root = parse(code);
    const fns = builder.extractTopLevelFunctions(root, '', 'Simple.kt');

    expect(fns).toHaveLength(1);
    expect(fns[0].startLine).toBeGreaterThanOrEqual(1);
    expect(fns[0].endLine).toBeGreaterThanOrEqual(fns[0].startLine);
  });
});
