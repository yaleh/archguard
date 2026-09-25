import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DuplicateAnalysis } from '@/analysis/duplicates/types.js';
import { registerDuplicateTools } from '@/cli/mcp/tools/duplicate-tools.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

function captureHandler(root: string): { handler: Handler; names: string[] } {
  const names: string[] = [];
  let handler: Handler = () => Promise.reject(new Error('tool not registered'));
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, h: Handler) => {
      names.push(name);
      handler = h;
    },
  } as unknown as McpServer;
  registerDuplicateTools(server, root);
  return { handler, names };
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

  it('persists the result under .archguard/query/duplicates/', async () => {
    await captureHandler(root).handler({ minStatements: 6, minTokens: 50, topN: 20 });
    expect(await fs.pathExists(path.join(root, '.archguard/query/duplicates/manifest.json'))).toBe(
      true
    );
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
