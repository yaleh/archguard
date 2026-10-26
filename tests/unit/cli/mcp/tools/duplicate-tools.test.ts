import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DuplicateAnalysis, DuplicateManifest } from '@/analysis/duplicates/types.js';
import { loadDuplicates } from '@/analysis/duplicates/persistence.js';
import { hashSources } from '@/cli/processors/arch-json-utils.js';
import { registerDuplicateTools } from '@/cli/mcp/tools/duplicate-tools.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

function captureHandler(root: string): {
  handler: Handler;
  names: string[];
  descriptions: Map<string, string>;
} {
  const names: string[] = [];
  const descriptions = new Map<string, string>();
  let handler: Handler = () => Promise.reject(new Error('tool not registered'));
  const server = {
    tool: (name: string, desc: string, _schema: unknown, h: Handler) => {
      names.push(name);
      descriptions.set(name, desc);
      handler = h;
    },
  } as unknown as McpServer;
  registerDuplicateTools(server, root);
  return { handler, names, descriptions };
}

const copy = (name: string, v: string): string =>
  `export function ${name}(src: string[]) {
  const ${v}Out = [];
  for (const ${v}E of src) {
    if (${v}E.length > 2) ${v}Out.push(clean(${v}E));
  }
  const ${v}N = ${v}Out.length;
  log('n', ${v}N);
  return ${v}Out;
}
`;

describe('archguard_detect_duplicates', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dup-tool-'));
    await fs.outputFile(path.join(root, 'src/a.ts'), copy('one', 'a'));
    await fs.outputFile(path.join(root, 'src/b.ts'), copy('two', 'b'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('registers the tool under its ADR-007 name', () => {
    expect(captureHandler(root).names).toEqual(['archguard_detect_duplicates']);
  });

  it('returns groups, manifest and honours parameters', async () => {
    const { handler } = captureHandler(root);
    const res = await handler({ minStatements: 6, minTokens: 50, topN: 20, includeTests: false });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0].text) as DuplicateAnalysis;
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]).toMatchObject({
      members: expect.any(Array),
      hash: expect.any(String),
    });
    expect(parsed.groups[0].members[0]).toMatchObject({
      file: 'src/a.ts',
      name: 'one',
      kind: 'function',
    });
    expect(parsed.manifest.options).toMatchObject({ minStatements: 6, minTokens: 50 });

    const strict = JSON.parse(
      (await handler({ minStatements: 60, minTokens: 50, topN: 20, includeTests: false }))
        .content[0].text
    );
    expect(strict.groups).toHaveLength(0);
  });

  it('passes trackedOnly through to the scan options', async () => {
    const { handler } = captureHandler(root);

    const withFlag = JSON.parse(
      (await handler({ minStatements: 6, minTokens: 50, topN: 20, trackedOnly: true })).content[0]
        .text
    ) as DuplicateAnalysis;
    expect(withFlag.manifest.options.trackedOnly).toBe(true);

    const byDefault = JSON.parse(
      (await handler({ minStatements: 6, minTokens: 50, topN: 20 })).content[0].text
    ) as DuplicateAnalysis;
    expect(byDefault.manifest.options.trackedOnly).toBe(false);
  });

  it('persists the result under a per-scope directory and never in the legacy flat files', async () => {
    await captureHandler(root).handler({ minStatements: 6, minTokens: 50, topN: 20 });

    const scopeKey = hashSources([path.join(root, 'src')], 'typescript');
    const dupRoot = path.join(root, '.archguard/query/duplicates');
    const manifest = (await fs.readJson(
      path.join(dupRoot, scopeKey, 'manifest.json')
    )) as DuplicateManifest;

    expect(manifest.scopeKey).toBe(scopeKey);
    expect(manifest.label).toBe('src (typescript)');
    expect(await fs.pathExists(path.join(dupRoot, scopeKey, 'groups.json'))).toBe(true);
    expect(await fs.pathExists(path.join(dupRoot, 'manifest.json'))).toBe(false);
    expect(await fs.pathExists(path.join(dupRoot, 'groups.json'))).toBe(false);
    expect((await loadDuplicates(path.join(root, '.archguard'), scopeKey))?.manifest).toEqual(
      manifest
    );
  });

  it('documents the Type-1/2 blind spot in the tool description', () => {
    const desc = captureHandler(root).descriptions.get('archguard_detect_duplicates') ?? '';
    expect(desc).toContain('Type-1/2');
    expect(desc).toMatch(/single-statement/i);
    expect(desc).toContain('minStatements');
  });

  it('stores two scopes side by side and lists both in index.json (DoD)', async () => {
    await fs.outputFile(path.join(root, 'other/x.ts'), copy('three', 'c'));
    await fs.outputFile(path.join(root, 'other/y.ts'), copy('four', 'd'));
    await fs.outputJson(path.join(root, '.archguard/query/manifest.json'), {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      globalScopeKey: 'aaaaaaaa',
      scopes: [
        {
          key: 'aaaaaaaa',
          label: 'src (typescript)',
          language: 'typescript',
          kind: 'parsed',
          sources: ['src'],
          entityCount: 1,
          relationCount: 0,
          hasAtlasExtension: false,
        },
        {
          key: 'bbbbbbbb',
          label: 'other (typescript)',
          language: 'typescript',
          kind: 'parsed',
          sources: ['other'],
          entityCount: 1,
          relationCount: 0,
          hasAtlasExtension: false,
        },
      ],
    });

    const { handler } = captureHandler(root);
    const first = await handler({ scope: 'aaaaaaaa', minStatements: 6, minTokens: 50, topN: 20 });
    const second = await handler({ scope: 'bbbbbbbb', minStatements: 6, minTokens: 50, topN: 20 });
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();

    const dupRoot = path.join(root, '.archguard/query/duplicates');
    const dirs = (await fs.readdir(dupRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(['aaaaaaaa', 'bbbbbbbb']);

    const a = (await fs.readJson(
      path.join(dupRoot, 'aaaaaaaa/manifest.json')
    )) as DuplicateManifest;
    const b = (await fs.readJson(
      path.join(dupRoot, 'bbbbbbbb/manifest.json')
    )) as DuplicateManifest;
    expect(a).toMatchObject({
      scopeKey: 'aaaaaaaa',
      label: 'src (typescript)',
      sources: ['src'],
    });
    expect(b).toMatchObject({
      scopeKey: 'bbbbbbbb',
      label: 'other (typescript)',
      sources: ['other'],
    });
    expect((await loadDuplicates(path.join(root, '.archguard'), 'aaaaaaaa'))?.groups).toHaveLength(
      1
    );
    expect((await loadDuplicates(path.join(root, '.archguard'), 'bbbbbbbb'))?.groups).toHaveLength(
      1
    );

    const index = (await fs.readJson(path.join(dupRoot, 'index.json'))) as {
      entries: Array<{ scopeKey: string; label: string; sources: string[]; generatedAt: string }>;
    };
    expect(index.entries.map((e) => e.scopeKey).sort()).toEqual(dirs);
    expect(index.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeKey: 'aaaaaaaa',
          label: 'src (typescript)',
          sources: ['src'],
        }),
        expect.objectContaining({
          scopeKey: 'bbbbbbbb',
          label: 'other (typescript)',
          sources: ['other'],
        }),
      ])
    );
    for (const entry of index.entries) expect(typeof entry.generatedAt).toBe('string');
  });

  it('returns an explicit error when the scope does not exist', async () => {
    const { handler } = captureHandler(root);
    const res = await handler({
      scope: 'no-such-scope',
      minStatements: 6,
      minTokens: 50,
      topN: 20,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Error: .*no-such-scope/);
  });

  it('errors on an unknown scope even when a manifest exists', async () => {
    await fs.outputJson(path.join(root, '.archguard/query/manifest.json'), {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      globalScopeKey: 'k1',
      scopes: [
        {
          key: 'k1',
          label: 'src',
          language: 'typescript',
          kind: 'parsed',
          sources: ['src'],
          entityCount: 1,
          relationCount: 0,
          hasAtlasExtension: false,
        },
      ],
    });
    const { handler } = captureHandler(root);
    const bad = await handler({ scope: 'zzz', minStatements: 6, minTokens: 50, topN: 20 });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('not found');
    const ok = await handler({ scope: 'k1', minStatements: 6, minTokens: 50, topN: 20 });
    expect((JSON.parse(ok.content[0].text) as DuplicateAnalysis).groups).toHaveLength(1);
  });

  it('errors when the scope sources point at a missing directory', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dup-empty-'));
    try {
      const res = await captureHandler(empty).handler({
        minStatements: 6,
        minTokens: 50,
        topN: 20,
      });
      expect(res.isError).toBe(true);
    } finally {
      await fs.remove(empty);
    }
  });
});
