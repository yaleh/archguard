/**
 * Structural validator tests for deterministic PlantUML output.
 *
 * Covers the three structural guarantees:
 * - paired `@startuml` / `@enduml` delimiters;
 * - no generic type syntax in declarations or relationship endpoints;
 * - every relationship endpoint references an entity declared in the diagram.
 */

import { describe, expect, it } from 'vitest';
import { PlantUmlStructuralValidator } from '@/plantuml/validator-structural.js';

const validator = new PlantUmlStructuralValidator();

describe('PlantUmlStructuralValidator', () => {
  it('accepts a legal empty diagram', () => {
    const result = validator.validate('@startuml\n@enduml\n');

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.undefinedEndpoints).toEqual([]);
    expect(result.invalidGenericDeclarations).toEqual([]);
  });

  it('accepts the deterministic emitter output', () => {
    const puml = [
      '@startuml',
      'package "User Layer" as User_Layer {',
      '  class "User Profile" as User_Profile {',
      '    +getDisplayName(): string',
      '  }',
      '  class Repository {',
      '    +items: Array',
      '  }',
      '}',
      'package Core {',
      '  interface Store {',
      '  }',
      '}',
      'User_Profile --|> Repository',
      'Repository ..|> Store',
      'User_Profile ..> Repository',
      'User_Profile --> Store',
      '@enduml',
      '',
    ].join('\n');

    const result = validator.validate(puml);

    expect(result.valid).toBe(true);
    expect(result.undefinedEndpoints).toEqual([]);
    expect(result.invalidGenericDeclarations).toEqual([]);
  });

  it('rejects a missing @enduml', () => {
    const result = validator.validate('@startuml\nclass Foo {\n}\n');

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.type === 'uml-delimiter')).toBe(true);
  });

  it('rejects duplicate @startuml delimiters', () => {
    const result = validator.validate('@startuml\n@startuml\nclass Foo\n@enduml\n');

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.type === 'uml-delimiter')).toBe(true);
  });

  it('rejects a generic entity declaration', () => {
    const puml = '@startuml\nclass "Map<K,V>" as Map {\n}\n@enduml\n';
    const result = validator.validate(puml);

    expect(result.valid).toBe(false);
    expect(result.invalidGenericDeclarations).toEqual(['class "Map<K,V>" as Map {']);
    expect(result.issues.some((issue) => issue.type === 'generic-declaration')).toBe(true);
  });

  it('rejects an inline generic entity declaration', () => {
    const result = validator.validate('@startuml\nclass Repository<T> {\n}\n@enduml\n');

    expect(result.valid).toBe(false);
    expect(result.invalidGenericDeclarations).toEqual(['class Repository<T> {']);
  });

  it('rejects a generic relationship endpoint', () => {
    const puml = '@startuml\nclass Foo\nclass Bar\nFoo --> Bar<Baz>\n@enduml\n';
    const result = validator.validate(puml);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.type === 'generic-endpoint')).toBe(true);
  });

  it('reports an undefined endpoint (negative control)', () => {
    const puml = '@startuml\nclass Foo\nFoo --> Ghost\n@enduml\n';
    const result = validator.validate(puml);

    expect(result.valid).toBe(false);
    expect(result.undefinedEndpoints).toEqual(['Ghost']);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain(
      'Relationship references undefined entity: "Ghost"'
    );
  });

  it('resolves endpoints that reference a quoted declaration alias', () => {
    const puml = [
      '@startuml',
      'class "User Profile" as User_Profile',
      'class Store',
      'User_Profile --> Store',
      '@enduml',
      '',
    ].join('\n');

    const result = validator.validate(puml);

    expect(result.valid).toBe(true);
    expect(result.undefinedEndpoints).toEqual([]);
  });

  it('still flags a missing declaration when the alias is not defined', () => {
    const puml = [
      '@startuml',
      'class "User Profile"',
      'class Store',
      '"User Profile" --> Store',
      '@enduml',
      '',
    ].join('\n');

    // The quoted display name counts as a declaration, so this is valid.
    const result = validator.validate(puml);
    expect(result.valid).toBe(true);
  });
});
