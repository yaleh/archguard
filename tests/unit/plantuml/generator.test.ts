/**
 * Deterministic PlantUML emitter tests.
 *
 * The golden file is compared byte-for-byte: the emitter must never depend on
 * wall-clock time, hash ordering, or an LLM. The same ArchJSON always produces
 * the same `.puml` bytes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlantUmlGenerator } from '@/plantuml/generator.js';
import type { GroupingDecision } from '@/mermaid/types.js';
import type { ArchJSON } from '@/types/index.js';

const GOLDEN_PATH = path.resolve('tests/fixtures/plantuml/golden-class.puml');

function buildArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceFiles: ['src/user.ts', 'src/core.ts'],
    entities: [
      {
        id: 'user-profile',
        name: 'User Profile',
        type: 'class',
        visibility: 'public',
        members: [
          {
            name: 'id',
            type: 'property',
            visibility: 'private',
            fieldType: 'string',
            isReadonly: true,
          },
          {
            name: 'getDisplayName',
            type: 'method',
            visibility: 'public',
            returnType: 'string',
            parameters: [],
          },
          {
            name: 'tags',
            type: 'property',
            visibility: 'public',
            fieldType: 'Map<string, string>',
          },
        ],
        sourceLocation: { file: 'src/user.ts', startLine: 1, endLine: 10 },
      },
      {
        id: 'repo',
        name: 'Repository<T>',
        type: 'class',
        visibility: 'public',
        members: [
          {
            name: 'items',
            type: 'property',
            visibility: 'public',
            fieldType: 'Array<T>',
          },
          {
            name: 'find',
            type: 'method',
            visibility: 'public',
            returnType: 'Promise<T | undefined>',
            parameters: [{ name: 'id', type: 'string' }],
          },
        ],
        sourceLocation: { file: 'src/user.ts', startLine: 12, endLine: 20 },
      },
      {
        id: 'store',
        name: 'Store',
        type: 'interface',
        visibility: 'public',
        members: [
          {
            name: 'save',
            type: 'method',
            visibility: 'public',
            returnType: 'void',
            parameters: [{ name: 'value', type: 'string' }],
          },
        ],
        sourceLocation: { file: 'src/core.ts', startLine: 1, endLine: 5 },
      },
      {
        id: 'kind',
        name: 'Kind',
        type: 'enum',
        visibility: 'public',
        members: [{ name: 'Admin', type: 'property', visibility: 'public' }],
        sourceLocation: { file: 'src/core.ts', startLine: 7, endLine: 9 },
      },
      {
        id: 'base',
        name: 'Base Entity',
        type: 'abstract_class',
        visibility: 'public',
        members: [
          {
            name: 'createdAt',
            type: 'property',
            visibility: 'protected',
            fieldType: 'Date',
          },
        ],
        sourceLocation: { file: 'src/core.ts', startLine: 11, endLine: 15 },
      },
    ],
    relations: [
      { id: 'r1', type: 'inheritance', source: 'user-profile', target: 'base' },
      { id: 'r2', type: 'implementation', source: 'repo', target: 'store' },
      { id: 'r3', type: 'dependency', source: 'user-profile', target: 'repo' },
      { id: 'r4', type: 'association', source: 'user-profile', target: 'store' },
    ],
  };
}

const GROUPING: GroupingDecision = {
  packages: [
    { name: 'User Layer', entities: ['user-profile', 'repo'] },
    { name: 'Core', entities: ['store', 'kind', 'base'] },
  ],
  layout: { direction: 'TB', reasoning: 'test fixture' },
};

describe('PlantUmlGenerator', () => {
  it('is byte-identical to the golden file', () => {
    const generator = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    });

    const actual = generator.generate();
    const golden = readFileSync(GOLDEN_PATH, 'utf-8');

    expect(actual).toBe(golden);
  });

  it('produces a legal empty diagram for empty ArchJSON', () => {
    const generator = new PlantUmlGenerator(
      {
        version: '1.1',
        language: 'typescript',
        timestamp: '2026-01-01T00:00:00.000Z',
        sourceFiles: [],
        entities: [],
        relations: [],
      },
      {
        level: 'class',
        grouping: {
          packages: [],
          layout: { direction: 'TB', reasoning: 'empty' },
        },
      }
    );

    expect(generator.generate()).toBe('@startuml\n@enduml\n');
  });

  it('does not emit illegal generic declarations or endpoints', () => {
    const puml = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    // No `Name<...>` survives in declarations, member types or endpoints.
    expect(puml).not.toMatch(/[A-Za-z_]\w*<[^>]*>/);
    expect(puml).toContain('class Repository {');
    expect(puml).toContain('+tags: Map');
  });

  it('quotes class names with spaces and references the alias at endpoints', () => {
    const puml = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    expect(puml).toContain('class "User Profile" as User_Profile {');
    expect(puml).toContain('abstract class "Base Entity" as Base_Entity {');
    // Endpoints reference aliases, never the quoted display names.
    expect(puml).toContain('User_Profile --|> Base_Entity');
    expect(puml).not.toContain('"User Profile" --|>');
  });

  it('emits all four relationship forms deterministically', () => {
    const puml = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    expect(puml).toContain('User_Profile --|> Base_Entity'); // inheritance
    expect(puml).toContain('Repository ..|> Store'); // implementation
    expect(puml).toContain('User_Profile ..> Repository'); // dependency
    expect(puml).toContain('User_Profile --> Store'); // association
  });

  it('emits package grouping blocks', () => {
    const puml = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    expect(puml).toContain('package "User Layer" as User_Layer {');
    expect(puml).toContain('package Core {');
    expect(puml.indexOf('package "User Layer"')).toBeLessThan(puml.indexOf('package Core {'));
  });

  it('is deterministic across repeated runs', () => {
    const first = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();
    const second = new PlantUmlGenerator(buildArchJson(), {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    expect(second).toBe(first);
  });

  it('skips relations whose endpoints are not declared entities', () => {
    const archJson = buildArchJson();
    const withDangling: ArchJSON = {
      ...archJson,
      relations: [
        ...archJson.relations,
        { id: 'dangling', type: 'dependency', source: 'user-profile', target: 'ExternalGhost' },
      ],
    };

    const puml = new PlantUmlGenerator(withDangling, {
      level: 'class',
      grouping: GROUPING,
    }).generate();

    expect(puml).not.toContain('ExternalGhost');
    expect(puml.match(/\.\.>/g)).toHaveLength(1);
  });
});
