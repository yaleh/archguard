/**
 * Integration test: verify that plugins produce ArchJSON with the correct
 * schema version constant and well-formed structural fields.
 *
 * Uses the TypeScript plugin (no external CLI required) against the
 * typescript-plugin fixture directory so no skip guard is needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import type { PluginInitConfig } from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';

describe('ArchJSON schema version integration', () => {
  let plugin: TypeScriptPlugin;
  let fixturesDir: string;
  let archJson: ArchJSON;

  beforeAll(async () => {
    plugin = new TypeScriptPlugin();
    fixturesDir = path.join(process.cwd(), 'tests', 'fixtures', 'typescript-plugin');

    const config: PluginInitConfig = {
      workspaceRoot: fixturesDir,
    };

    await plugin.initialize(config);

    // Parse the fixture directory to obtain a real ArchJSON
    const parseConfig: ParseConfig = {
      workspaceRoot: fixturesDir,
      excludePatterns: [],
    };
    archJson = await plugin.parseProject(fixturesDir, parseConfig);
  });

  afterAll(async () => {
    await plugin.dispose();
  });

  it('plugin output archJson.version equals ARCHJSON_SCHEMA_VERSION', () => {
    expect(ARCHJSON_SCHEMA_VERSION).toBe('1.1');
    expect(archJson.version).toBe(ARCHJSON_SCHEMA_VERSION);
  });

  it('entities, relations and sourceFiles are arrays', () => {
    expect(Array.isArray(archJson.entities)).toBe(true);
    expect(Array.isArray(archJson.relations)).toBe(true);
    expect(Array.isArray(archJson.sourceFiles)).toBe(true);
  });

  it('language field is populated', () => {
    expect(archJson.language).toBe('typescript');
  });

  it('every entity carries the required schema fields', () => {
    expect(archJson.entities.length).toBeGreaterThan(0);
    for (const entity of archJson.entities) {
      // Entity schema contract (src/types/index.ts:132-146): id/name/type are
      // non-empty and sourceLocation pins the entity to a source file.
      expect(entity.id).toBeTruthy();
      expect(entity.name).toBeTruthy();
      expect(typeof entity.type).toBe('string');
      expect(entity.type.length).toBeGreaterThan(0);
      expect(entity.sourceLocation).toBeDefined();
      expect(entity.sourceLocation.file).toBeTruthy();
      expect(Array.isArray(entity.members)).toBe(true);
    }
  });

  it('every relation carries the required schema fields', () => {
    // The typescript-plugin fixture (simple-class.ts) has no cross-entity edges,
    // so parse a source with extends/implements to exercise the relation schema.
    const parser = new TypeScriptParser();
    const sourceCode = `
      export class Parent {}
      export class Child extends Parent {}
      export interface Runnable { run(): void }
      export class Impl implements Runnable { run(): void {} }
    `;
    const parsed = parser.parseCode(sourceCode, 'relations-fixture.ts');

    const allowedRelationTypes = new Set([
      'inheritance',
      'implementation',
      'composition',
      'aggregation',
      'dependency',
      'association',
      'call',
    ]);
    expect(parsed.relations.length).toBeGreaterThan(0);
    for (const relation of parsed.relations) {
      // Relation schema contract (src/types/index.ts:214-232): id/type/source/
      // target are required, and type is one of the RelationType union.
      expect(relation.id).toBeTruthy();
      expect(relation.source).toBeTruthy();
      expect(relation.target).toBeTruthy();
      expect(allowedRelationTypes.has(relation.type)).toBe(true);
    }
  });

  it('sourceFiles entries are non-empty strings', () => {
    for (const sourceFile of archJson.sourceFiles) {
      expect(typeof sourceFile).toBe('string');
      expect(sourceFile.length).toBeGreaterThan(0);
    }
  });
});
