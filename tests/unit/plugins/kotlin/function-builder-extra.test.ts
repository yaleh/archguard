/**
 * TASK-71 — FunctionBuilder branch-dense path extra tests.
 *
 * Fills gaps in function-builder.test.ts around the type-node branches:
 *   - nullable return type (`fun foo(): String?`) → 'String?'
 *   - nullable parameter type → 'String?'
 *   - function_type (lambda) return type → raw lambda text
 *   - protected visibility modifier
 *   - multiple typed parameters → ordered paramTypes
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FunctionBuilder } from '@/plugins/kotlin/builders/function-builder.js';

let parse: (code: string) => any;

beforeAll(async () => {
  const { default: Parser } = await import('tree-sitter');
  const { default: KotlinLanguage } = await import('@tree-sitter-grammars/tree-sitter-kotlin');
  const p = new Parser();
  p.setLanguage(KotlinLanguage);
  parse = (code: string) => p.parse(code).rootNode;
});

function extract(code: string) {
  const builder = new FunctionBuilder();
  return builder.extractTopLevelFunctions(parse(code), 'com.example', 'Probe.kt');
}

describe('FunctionBuilder — nullable return type branch', () => {
  it('returns "String?" for a nullable return type', () => {
    const fn = extract('fun lookup(): String? { return null }')[0];
    expect(fn.returnType).toBe('String?');
  });
});

describe('FunctionBuilder — nullable parameter type branch', () => {
  it('returns ["String?"] for a nullable parameter', () => {
    const fn = extract('fun greet(name: String?): Unit {}')[0];
    expect(fn.paramTypes).toEqual(['String?']);
  });
});

describe('FunctionBuilder — function_type (lambda) return type branch', () => {
  it('returns the raw lambda text for a function_type return', () => {
    const fn = extract('fun transform(): (Int) -> String { return { it.toString() } }')[0];
    expect(fn.returnType).toBe('(Int) -> String');
  });
});

describe('FunctionBuilder — visibility branch', () => {
  it('extracts protected visibility', () => {
    const fn = extract('protected fun helper(): Int { return 1 }')[0];
    expect(fn.visibility).toBe('protected');
  });

  it('extracts private visibility', () => {
    const fn = extract('private fun helper(): Int { return 1 }')[0];
    expect(fn.visibility).toBe('private');
  });
});

describe('FunctionBuilder — multiple typed parameters', () => {
  it('returns ordered paramTypes for several parameters', () => {
    const fn = extract('fun save(user: User, repo: Repo): Unit {}')[0];
    expect(fn.paramTypes).toEqual(['User', 'Repo']);
  });

  it('returns paramTypes but no returnType when return type omitted', () => {
    const fn = extract('fun consume(x: Int) {}')[0];
    expect(fn.paramTypes).toEqual(['Int']);
    expect(fn.returnType).toBeUndefined();
  });
});
