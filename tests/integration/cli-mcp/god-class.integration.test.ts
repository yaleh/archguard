/**
 * Integration tests for archguard_detect_god_classes over a real MCP transport.
 *
 * Uses InMemoryTransport + createMcpServer so the call exercises the SDK's
 * schema coercion, parameter validation, and protocol serialization — not just
 * the handler function reached via a `server.tool()` spy (ADR-007 §2).
 */
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';
import { createQueryCommand } from '@/cli/commands/query.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSON, Entity } from '@/types/index.js';

function makeEntity(
  id: string,
  name: string,
  methodCount: number,
  fieldCount: number,
  loc: number
): Entity {
  const members: Entity['members'] = [];
  for (let i = 0; i < methodCount; i++) {
    members.push({ name: `m${i}`, type: 'method', visibility: 'public' });
  }
  for (let i = 0; i < fieldCount; i++) {
    members.push({ name: `f${i}`, type: 'field', visibility: 'public', fieldType: 'int' });
  }
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members,
    sourceLocation: { file: 'lib/a.dart', startLine: 1, endLine: loc },
  };
}

function makeDartArchJson(entities: Entity[]): ArchJSON {
  return {
    version: '1.1',
    language: 'dart',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['lib/a.dart'],
    entities,
    relations: [],
  };
}

const SCOPE_KEY = 'dartscope';
// Big (50 methods) is always a god class; Medium (15 methods) only trips when
// minMethods is lowered below 15.
const BIG = makeEntity('a.Big', 'Big', 50, 5, 100);
const MEDIUM = makeEntity('a.Medium', 'Medium', 15, 2, 60);

const DART_SCOPE: QueryScopeEntry = {
  key: SCOPE_KEY,
  label: 'lib (dart)',
  language: 'dart',
  kind: 'parsed',
  sources: ['/project/lib'],
  entityCount: 2,
  relationCount: 0,
  hasAtlasExtension: false,
};

describe('archguard_detect_god_classes — MCP transport integration', () => {
  let tmpRoot: string;
  let client: Client;

  beforeAll(async () => {
    tmpRoot = path.join(os.tmpdir(), `archguard-god-class-test-${Math.floor(Math.random() * 1e9)}`);
    const queryDir = path.join(tmpRoot, '.archguard', 'query');
    await fs.mkdirp(path.join(queryDir, SCOPE_KEY));

    await fs.writeJson(
      path.join(queryDir, 'manifest.json'),
      {
        globalScopeKey: SCOPE_KEY,
        scopes: [
          {
            key: SCOPE_KEY,
            label: 'lib (dart)',
            language: 'dart',
            kind: 'parsed',
            sources: ['/project/lib'],
            entityCount: 2,
            relationCount: 0,
            hasAtlasExtension: false,
          },
        ],
      },
      { spaces: 2 }
    );
    await fs.writeJson(
      path.join(queryDir, SCOPE_KEY, 'arch.json'),
      makeDartArchJson([BIG, MEDIUM]),
      {
        spaces: 2,
      }
    );

    const server = createMcpServer(tmpRoot);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'god-class-test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await fs.remove(tmpRoot);
  });

  async function call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await client.callTool({
      name: 'archguard_detect_god_classes',
      arguments: args,
    });
    return JSON.parse(result.content[0].text as string) as Record<string, unknown>;
  }

  async function runCliGodClasses(archDir: string): Promise<Record<string, unknown>> {
    const cmd = createQueryCommand();
    cmd.exitOverride();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    try {
      await cmd.parseAsync([
        'node',
        'query',
        '--god-classes',
        '--arch-dir',
        archDir,
        '--format',
        'json',
      ]);
    } finally {
      console.log = orig;
    }
    return JSON.parse(logs.join('\n')) as Record<string, unknown>;
  }

  it('detects god classes with default thresholds over the wire', async () => {
    const json = await call({ projectRoot: tmpRoot });
    expect(json.language).toBe('dart');
    expect(json.totalEntities).toBe(2);
    expect(json.godClasses).toHaveLength(1);
    expect((json.godClasses as Array<{ name: string }>)[0].name).toBe('Big');
  });

  it('honors custom thresholds over the wire', async () => {
    const json = await call({
      projectRoot: tmpRoot,
      minMethods: 10,
      minFields: 0,
      minLoc: 0,
      minFanIn: 0,
    });
    const names = (json.godClasses as Array<{ name: string }>).map((g) => g.name);
    expect(names).toContain('Big');
    expect(names).toContain('Medium');
  });

  it('rejects a decimal threshold at the schema layer', async () => {
    const result = await client.callTool({
      name: 'archguard_detect_god_classes',
      arguments: { projectRoot: tmpRoot, minMethods: 1.5 },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('validation error');
  });

  it('rejects a negative threshold at the schema layer', async () => {
    const result = await client.callTool({
      name: 'archguard_detect_god_classes',
      arguments: { projectRoot: tmpRoot, minMethods: -1 },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('validation error');
  });

  it('matches QueryEngine.detectGodClasses for the same fixture (core/MCP equivalence)', async () => {
    const archJson = makeDartArchJson([BIG, MEDIUM]);
    const archIndex = buildArchIndex(archJson, 'testhash');
    const engine = new QueryEngine({ archJson, archIndex, scopeEntry: DART_SCOPE });
    const engineNames = engine.detectGodClasses().map((g) => g.name);

    const json = await call({ projectRoot: tmpRoot });
    expect(json.totalEntities).toBe(2);
    expect((json.godClasses as Array<{ name: string }>).map((g) => g.name)).toEqual(engineNames);
  });

  it.each([
    ['boolean true', true],
    ['boolean false', false],
    ['null', null],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['numeric string', '10'],
    ['decimal', 1.5],
    ['negative', -1],
    ['non-numeric string', 'abc'],
  ])('rejects an invalid threshold (%s) at the schema layer', async (_label, value) => {
    const result = await client.callTool({
      name: 'archguard_detect_god_classes',
      arguments: { projectRoot: tmpRoot, minMethods: value },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('validation error');
  });

  it('returns the same result as the real CLI adapter on the same fixture (CLI/MCP parity)', async () => {
    const cliResult = await runCliGodClasses(path.join(tmpRoot, '.archguard'));
    const mcpJson = await call({ projectRoot: tmpRoot });

    expect(cliResult.language).toBe('dart');
    expect(cliResult.totalEntities).toBe(2);
    expect(mcpJson.language).toBe('dart');
    expect(mcpJson.totalEntities).toBe(2);
    expect(cliResult.godClasses).toEqual(mcpJson.godClasses);
  });
});

describe('QueryEngine.detectGodClasses — defaults and partial override', () => {
  function engineFor(entities: Entity[]): QueryEngine {
    const archJson = makeDartArchJson(entities);
    const archIndex = buildArchIndex(archJson, 'testhash');
    return new QueryEngine({ archJson, archIndex, scopeEntry: DART_SCOPE });
  }

  it('applies defaults when no thresholds are given', () => {
    const names = engineFor([BIG, MEDIUM])
      .detectGodClasses()
      .map((g) => g.name);
    expect(names).toEqual(['Big']);
  });

  it('applies partial overrides and keeps other defaults', () => {
    const names = engineFor([BIG, MEDIUM])
      .detectGodClasses({ minMethods: 10, minFields: 0, minLoc: 0, minFanIn: 0 })
      .map((g) => g.name);
    expect(names).toEqual(['Big', 'Medium']);
  });

  it('does not let an undefined threshold override a default', () => {
    const names = engineFor([BIG, MEDIUM])
      .detectGodClasses({ minMethods: undefined })
      .map((g) => g.name);
    expect(names).toEqual(['Big']);
  });
});

describe('archguard_detect_god_classes — non-Dart guard over transport', () => {
  let tsRoot: string;
  let client: Client;

  beforeAll(async () => {
    tsRoot = path.join(os.tmpdir(), `archguard-god-class-ts-${Math.floor(Math.random() * 1e9)}`);
    const queryDir = path.join(tsRoot, '.archguard', 'query');
    const tsScope = 'tsscope';
    await fs.mkdirp(path.join(queryDir, tsScope));
    await fs.writeJson(
      path.join(queryDir, 'manifest.json'),
      {
        globalScopeKey: tsScope,
        scopes: [
          {
            key: tsScope,
            label: 'src (typescript)',
            language: 'typescript',
            kind: 'parsed',
            sources: ['/project/src'],
            entityCount: 1,
            relationCount: 0,
            hasAtlasExtension: false,
          },
        ],
      },
      { spaces: 2 }
    );
    await fs.writeJson(path.join(queryDir, tsScope, 'arch.json'), makeDartArchJson([BIG]), {
      spaces: 2,
    });

    const server = createMcpServer(tsRoot);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'god-class-ts-test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await fs.remove(tsRoot);
  });

  it('rejects a non-Dart project with a Dart-only message (not a crash)', async () => {
    const result = await client.callTool({
      name: 'archguard_detect_god_classes',
      arguments: { projectRoot: tsRoot },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Dart-only');
    expect(text).toContain('typescript');
  });
});
