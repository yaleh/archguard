/**
 * Unit tests for Kotlin ClassBuilder.
 *
 * Uses inline Kotlin source strings parsed via tree-sitter-kotlin.
 * No file I/O — the parser is set up once in beforeAll.
 *
 * AST notes (from AST_NODES.md):
 *   - modifiers > class_modifier  → data / sealed / enum
 *   - modifiers > inheritance_modifier → abstract / open / final
 *   - modifiers > visibility_modifier  → private / protected / internal
 *   - delegation_specifiers > delegation_specifier
 *       constructor_invocation > user_type  ← class (with ())
 *       user_type                           ← interface (no ())
 *   - companion_object (not object_declaration) inside class_body
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ClassBuilder } from '@/plugins/kotlin/builders/class-builder.js';

// ─── parser bootstrap ────────────────────────────────────────────────────────

let builder: ClassBuilder;
let parse: (code: string) => any;

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Parser = require('tree-sitter');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const KotlinLanguage = require('@tree-sitter-grammars/tree-sitter-kotlin');

  const parser = new Parser();
  parser.setLanguage(KotlinLanguage);

  parse = (code: string) => parser.parse(code).rootNode;
  builder = new ClassBuilder();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractClasses(code: string) {
  const rootNode = parse(code);
  return builder.extractClasses(rootNode, 'com.example', 'Test.kt');
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ClassBuilder — data class', () => {
  it('identifies kind as data_class', () => {
    const classes = extractClasses('data class Foo(val name: String, val id: Int)');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('data_class');
  });

  it('extracts primary constructor val parameters as fields', () => {
    const classes = extractClasses('data class Foo(val name: String, val id: Int)');
    const members = classes[0].members;
    expect(members).toHaveLength(2);
    expect(members[0].kind).toBe('field');
    expect(members[0].name).toBe('name');
    expect(members[1].name).toBe('id');
  });

  it('sets correct class name and package', () => {
    const classes = extractClasses('data class Foo(val name: String, val id: Int)');
    expect(classes[0].name).toBe('Foo');
    expect(classes[0].packageName).toBe('com.example');
    expect(classes[0].filePath).toBe('Test.kt');
  });

  it('ignores non-val/var primary constructor parameters', () => {
    // plain parameter (no val/var) should NOT become a field
    const classes = extractClasses('class Foo(name: String)');
    expect(classes[0].members).toHaveLength(0);
  });
});

describe('ClassBuilder — sealed interface', () => {
  it('identifies kind as sealed_interface', () => {
    const classes = extractClasses('sealed interface Result');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('sealed_interface');
  });
});

describe('ClassBuilder — sealed class', () => {
  it('identifies kind as sealed_class', () => {
    const classes = extractClasses('sealed class Result');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('sealed_class');
  });
});

describe('ClassBuilder — supertype extraction', () => {
  it('extracts class with constructor invocation as superType', () => {
    const classes = extractClasses('class Foo : Bar()');
    expect(classes[0].superTypes).toContain('Bar');
  });

  it('extracts interface without () as superType', () => {
    const classes = extractClasses('class Foo : IBar');
    expect(classes[0].superTypes).toContain('IBar');
  });

  it('extracts both superclass and interface', () => {
    const classes = extractClasses('class Foo : Bar(), IBar');
    expect(classes[0].superTypes).toContain('Bar');
    expect(classes[0].superTypes).toContain('IBar');
    expect(classes[0].superTypes).toHaveLength(2);
  });
});

describe('ClassBuilder — object declaration', () => {
  it('identifies kind as object', () => {
    const classes = extractClasses('object Singleton');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('object');
    expect(classes[0].name).toBe('Singleton');
  });

  it('extracts object body members', () => {
    const code = `
object Singleton {
  val x: Int = 1
  fun doSomething() {}
}`;
    const classes = extractClasses(code);
    expect(classes[0].members.some((m) => m.name === 'x')).toBe(true);
    expect(classes[0].members.some((m) => m.name === 'doSomething')).toBe(true);
  });
});

describe('ClassBuilder — companion object', () => {
  it('identifies companion object with kind companion_object', () => {
    const code = `
class WithCompanion {
  companion object {
    const val X = 1
  }
}`;
    const classes = extractClasses(code);
    const companion = classes.find((c) => c.kind === 'companion_object');
    expect(companion).toBeDefined();
  });

  it('marks companion object members as isStatic = true', () => {
    const code = `
class WithCompanion {
  companion object {
    val X: Int = 1
  }
}`;
    const classes = extractClasses(code);
    const companion = classes.find((c) => c.kind === 'companion_object');
    expect(companion).toBeDefined();
    const member = companion!.members.find((m) => m.name === 'X');
    expect(member).toBeDefined();
    expect(member!.isStatic).toBe(true);
  });
});

describe('ClassBuilder — enum class', () => {
  it('identifies kind as enum_class', () => {
    const classes = extractClasses('enum class Status { ACTIVE, INACTIVE }');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('enum_class');
  });

  it('extracts enum entries as members', () => {
    const classes = extractClasses('enum class Status { ACTIVE, INACTIVE }');
    const names = classes[0].members.map((m) => m.name);
    expect(names).toContain('ACTIVE');
    expect(names).toContain('INACTIVE');
  });
});

describe('ClassBuilder — abstract class', () => {
  it('identifies kind as abstract_class', () => {
    const classes = extractClasses('abstract class Base');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('abstract_class');
  });
});

describe('ClassBuilder — interface', () => {
  it('identifies plain interface kind', () => {
    const classes = extractClasses('interface Callback { fun onDone() }');
    expect(classes).toHaveLength(1);
    expect(classes[0].kind).toBe('interface');
  });
});

describe('ClassBuilder — annotations', () => {
  it('extracts single annotation into decorators', () => {
    const classes = extractClasses('@SomeAnnotation class Foo');
    expect(classes[0].decorators).toContain('SomeAnnotation');
  });

  it('extracts multiple annotations', () => {
    const classes = extractClasses('@First @Second class Foo');
    expect(classes[0].decorators).toContain('First');
    expect(classes[0].decorators).toContain('Second');
  });
});

describe('ClassBuilder — visibility', () => {
  it('extracts private visibility', () => {
    const classes = extractClasses('private class Hidden');
    expect(classes[0].visibility).toBe('private');
  });

  it('defaults to public when no modifier present', () => {
    const classes = extractClasses('class Visible');
    expect(classes[0].visibility).toBe('public');
  });

  it('extracts internal visibility', () => {
    const classes = extractClasses('internal class ModuleLocal');
    expect(classes[0].visibility).toBe('internal');
  });
});

describe('ClassBuilder — empty class', () => {
  it('returns empty members array for empty class body', () => {
    const classes = extractClasses('class Empty {}');
    expect(classes).toHaveLength(1);
    expect(classes[0].members).toHaveLength(0);
  });

  it('returns empty members for class without body', () => {
    const classes = extractClasses('class Empty');
    expect(classes[0].members).toHaveLength(0);
  });
});

describe('ClassBuilder — class body members', () => {
  it('extracts field from property_declaration', () => {
    const code = `
class Repo {
  private val db: Database = TODO()
}`;
    const classes = extractClasses(code);
    const field = classes[0].members.find((m) => m.name === 'db');
    expect(field).toBeDefined();
    expect(field!.kind).toBe('field');
    expect(field!.visibility).toBe('private');
  });

  it('extracts method from function_declaration', () => {
    const code = `
class Service {
  fun doWork(): String = ""
}`;
    const classes = extractClasses(code);
    const method = classes[0].members.find((m) => m.name === 'doWork');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });
});

describe('ClassBuilder — line numbers', () => {
  it('records startLine and endLine (1-based)', () => {
    const code = `\nclass Foo {\n  val x: Int = 1\n}\n`;
    const classes = extractClasses(code);
    expect(classes[0].startLine).toBeGreaterThanOrEqual(1);
    expect(classes[0].endLine).toBeGreaterThanOrEqual(classes[0].startLine);
  });
});
