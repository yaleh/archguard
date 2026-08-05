/**
 * TASK-71 — ClassBuilder branch-dense path extra tests.
 *
 * Fills gaps in class-builder.test.ts around the type/decorator/supertype
 * branches:
 *   - object_declaration with a supertype (buildObject superTypes path)
 *   - nullable field type (buildFieldMember nullable_type branch)
 *   - generic field type (extractUserTypeName strips generics → 'List')
 *   - annotation WITH arguments (@InstallIn(...::class)) → decorator name
 *   - primary constructor nullable parameter type
 *   - named companion object (name falls back to explicit identifier)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ClassBuilder } from '@/plugins/kotlin/builders/class-builder.js';

let parse: (code: string) => any;

beforeAll(async () => {
  const { default: Parser } = await import('tree-sitter');
  const { default: KotlinLanguage } = await import('@tree-sitter-grammars/tree-sitter-kotlin');
  const p = new Parser();
  p.setLanguage(KotlinLanguage);
  parse = (code: string) => p.parse(code).rootNode;
});

function extractClasses(code: string) {
  const builder = new ClassBuilder();
  return builder.extractClasses(parse(code), 'com.example', 'Probe.kt');
}

describe('ClassBuilder — object with supertype', () => {
  it('extracts superTypes from object_declaration', () => {
    const classes = extractClasses('object Logger : ILogger { fun log() {} }');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('object');
    expect(classes[0].superTypes).toContain('ILogger');
  });
});

describe('ClassBuilder — nullable field type branch', () => {
  it('extracts "Int?" from a nullable property type', () => {
    const classes = extractClasses('class Foo { val x: Int? = null }');
    const field = classes[0].members.find((m) => m.name === 'x');
    expect(field?.type).toBe('Int?');
  });
});

describe('ClassBuilder — generic field type branch', () => {
  it('strips generics when extracting a generic field type', () => {
    const classes = extractClasses('class Foo { val items: List<String> = listOf() }');
    const field = classes[0].members.find((m) => m.name === 'items');
    expect(field?.type).toBe('List');
  });
});

describe('ClassBuilder — annotation with arguments branch', () => {
  it('extracts decorator name from annotation with constructor_invocation', () => {
    const classes = extractClasses('@InstallIn(SingletonComponent::class) class Foo');
    expect(classes[0].decorators).toContain('InstallIn');
  });
});

describe('ClassBuilder — primary constructor nullable parameter', () => {
  it('extracts "String?" as the field type for a nullable val param', () => {
    const classes = extractClasses('data class Foo(val name: String?)');
    expect(classes[0].members).toHaveLength(1);
    expect(classes[0].members[0].type).toBe('String?');
  });
});

describe('ClassBuilder — named companion object', () => {
  it('uses the explicit companion object name (not the fallback "Companion")', () => {
    const code = `
class WithCompanion {
  companion object Factory {
    val X: Int = 1
  }
}`;
    const classes = extractClasses(code);
    const companion = classes.find((c) => c.kind === 'companion_object');
    expect(companion?.name).toBe('Factory');
  });
});
