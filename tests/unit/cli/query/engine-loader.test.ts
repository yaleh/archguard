import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { resolveScope, loadEngine } from '@/cli/query/engine-loader.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { QueryManifest, QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSON } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [
      {
        id: 'A',
        name: 'Alpha',
        type: 'class',
        visibility: 'public',
        members: [],
        sourceLocation: { file: 'src/alpha.ts', startLine: 1, endLine: 10 },
      },
    ],
    relations: [],
    ...overrides,
  };
}

const scope1: QueryScopeEntry = {
  key: 'scope-1',
  label: 'src',
  kind: 'parsed',
  sources: ['./src'],
  language: 'typescript',
  entityCount: 100,
  relationCount: 50,
  hasAtlasExtension: false,
};

const scope2: QueryScopeEntry = {
  key: 'scope-2',
  label: 'lib',
  kind: 'derived',
  sources: ['./lib'],
  language: 'typescript',
  entityCount: 30,
  relationCount: 10,
  hasAtlasExtension: false,
};

function makeManifest(scopes: QueryScopeEntry[]): QueryManifest {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    globalScopeKey: scopes[0]?.key,
    scopes,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-loader-test-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

async function writeManifest(scopes: QueryScopeEntry[]): Promise<void> {
  const manifestDir = path.join(tmpDir, 'query');
  await fs.ensureDir(manifestDir);
  await fs.writeJson(path.join(manifestDir, 'manifest.json'), makeManifest(scopes));
}

async function writeScopeArchJson(
  scopeKey: string,
  archJson: ArchJSON,
): Promise<{ archJsonHash: string }> {
  const scopeDir = path.join(tmpDir, 'query', scopeKey);
  await fs.ensureDir(scopeDir);
  const content = JSON.stringify(archJson);
  await fs.writeFile(path.join(scopeDir, 'arch.json'), content, 'utf-8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return { archJsonHash: hash };
}

async function writeScopeArchIndex(
  scopeKey: string,
  archJson: ArchJSON,
  archJsonHash: string,
): Promise<void> {
  const scopeDir = path.join(tmpDir, 'query', scopeKey);
  await fs.ensureDir(scopeDir);
  const index = buildArchIndex(archJson, archJsonHash);
  await fs.writeJson(path.join(scopeDir, 'arch-index.json'), index);
}

// ---------------------------------------------------------------------------
// resolveScope tests
// ---------------------------------------------------------------------------

describe('resolveScope', () => {
  it('auto-selects when only one scope exists and no scopeKey given', async () => {
    await writeManifest([scope1]);
    const result = await resolveScope(tmpDir);
    expect(result.key).toBe('scope-1');
    expect(result.label).toBe('src');
  });

  it('uses globalScopeKey when multiple scopes and no --scope', async () => {
    await writeManifest([scope1, scope2]);
    const result = await resolveScope(tmpDir);
    expect(result.key).toBe('scope-1');
  });

  it('accepts the synthetic "global" scope alias', async () => {
    const big: QueryScopeEntry = { ...scope1, key: 'big', label: 'full src', entityCount: 300 };
    const small: QueryScopeEntry = { ...scope1, key: 'small', label: 'partial', entityCount: 50 };
    const manifest: QueryManifest = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      globalScopeKey: 'big',
      scopes: [small, big],
    };
    const manifestDir = path.join(tmpDir, 'query');
    await fs.ensureDir(manifestDir);
    await fs.writeJson(path.join(manifestDir, 'manifest.json'), manifest);
    const result = await resolveScope(tmpDir, 'global');
    expect(result.key).toBe('big');
  });

  it('throws when multiple scopes exist but no global scope is defined', async () => {
    const manifestDir = path.join(tmpDir, 'query');
    await fs.ensureDir(manifestDir);
    await fs.writeJson(path.join(manifestDir, 'manifest.json'), {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      scopes: [scope1, scope2],
    });

    await expect(resolveScope(tmpDir)).rejects.toThrow(/No global query scope configured/);
    await expect(resolveScope(tmpDir)).rejects.not.toThrow(/--scope/);
  });

  it('throws when unknown scope key is given', async () => {
    await writeManifest([scope1]);
    await expect(resolveScope(tmpDir, 'nonexistent')).rejects.toThrow(
      'Scope "nonexistent" not found',
    );
  });

  it('uses MCP-neutral guidance when the global alias is unavailable', async () => {
    const manifestDir = path.join(tmpDir, 'query');
    await fs.ensureDir(manifestDir);
    await fs.writeJson(path.join(manifestDir, 'manifest.json'), {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      scopes: [scope1, scope2],
    });

    await expect(resolveScope(tmpDir, 'global')).rejects.toThrow(/pass scope parameter explicitly/i);
    await expect(resolveScope(tmpDir, 'global')).rejects.not.toThrow(/--scope/);
  });

  it('selects the correct scope when key matches', async () => {
    await writeManifest([scope1, scope2]);
    const result = await resolveScope(tmpDir, 'scope-2');
    expect(result.key).toBe('scope-2');
    expect(result.label).toBe('lib');
  });

  it('selects scope by label substring match', async () => {
    await writeManifest([scope1, scope2]);
    const result = await resolveScope(tmpDir, 'lib');
    expect(result.key).toBe('scope-2');
  });

  it('throws when manifest does not exist', async () => {
    await expect(resolveScope(tmpDir)).rejects.toThrow(
      'No query data found',
    );
  });

  it('throws when manifest has zero scopes', async () => {
    await writeManifest([]);
    await expect(resolveScope(tmpDir)).rejects.toThrow(
      'No query scopes available',
    );
  });
});

// ---------------------------------------------------------------------------
// loadEngine tests
// ---------------------------------------------------------------------------

describe('loadEngine', () => {
  it('builds index when arch-index.json is missing', async () => {
    const archJson = makeArchJson();
    await writeManifest([scope1]);
    await writeScopeArchJson(scope1.key, archJson);

    const engine = await loadEngine(tmpDir);
    expect(engine.findEntity('Alpha')).toHaveLength(1);

    // Verify that arch-index.json was persisted
    const indexPath = path.join(tmpDir, 'query', scope1.key, 'arch-index.json');
    expect(await fs.pathExists(indexPath)).toBe(true);
  });

  it('uses existing index when hash matches', async () => {
    const archJson = makeArchJson();
    await writeManifest([scope1]);
    const { archJsonHash } = await writeScopeArchJson(scope1.key, archJson);
    await writeScopeArchIndex(scope1.key, archJson, archJsonHash);

    const engine = await loadEngine(tmpDir);
    expect(engine.findEntity('Alpha')).toHaveLength(1);
  });

  it('rebuilds index when hash mismatches', async () => {
    const archJson = makeArchJson();
    await writeManifest([scope1]);
    await writeScopeArchJson(scope1.key, archJson);

    // Write an index with a wrong hash
    const scopeDir = path.join(tmpDir, 'query', scope1.key);
    const staleIndex = buildArchIndex(archJson, 'wrong-hash');
    await fs.writeJson(path.join(scopeDir, 'arch-index.json'), staleIndex);

    const engine = await loadEngine(tmpDir);
    // Engine should still work correctly after rebuild
    expect(engine.findEntity('Alpha')).toHaveLength(1);

    // Verify the index was rewritten with correct hash
    const rewrittenIndex = await fs.readJson(
      path.join(scopeDir, 'arch-index.json'),
    );
    const archJsonContent = await fs.readFile(
      path.join(scopeDir, 'arch.json'),
      'utf-8',
    );
    const correctHash = crypto
      .createHash('sha256')
      .update(archJsonContent)
      .digest('hex');
    expect(rewrittenIndex.archJsonHash).toBe(correctHash);
  });

  it('throws when arch.json is missing for the scope', async () => {
    await writeManifest([scope1]);
    // Don't write arch.json
    await expect(loadEngine(tmpDir)).rejects.toThrow(
      'arch.json missing for scope',
    );
  });

  it('rebuilds when arch-index.json is corrupted', async () => {
    const archJson = makeArchJson();
    await writeManifest([scope1]);
    await writeScopeArchJson(scope1.key, archJson);

    // Write corrupted index
    const scopeDir = path.join(tmpDir, 'query', scope1.key);
    await fs.writeFile(
      path.join(scopeDir, 'arch-index.json'),
      'not valid json{{{',
      'utf-8',
    );

    const engine = await loadEngine(tmpDir);
    expect(engine.findEntity('Alpha')).toHaveLength(1);
  });
});
