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
});
