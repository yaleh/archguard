import { describe, it, expect } from 'vitest';
import type {
  QueryManifest,
  QueryScopeEntry,
  QuerySourceGroup,
} from '@/cli/query/query-manifest.js';
import type { ArchJSON } from '@/types/index.js';

describe('QueryManifest types', () => {
  it('should allow constructing a QueryManifest with empty scopes', () => {
    const manifest: QueryManifest = {
      version: '1.0',
      generatedAt: '2026-03-07T00:00:00.000Z',
      scopes: [],
    };

    expect(manifest.version).toBe('1.0');
    expect(manifest.scopes).toHaveLength(0);
  });

  it('should allow constructing a QueryManifest with multiple scopes', () => {
    const scope1: QueryScopeEntry = {
      key: 'abcd1234',
      label: 'src/cli',
      language: 'typescript',
      kind: 'parsed',
      sources: ['src/cli'],
      entityCount: 42,
      relationCount: 18,
      hasAtlasExtension: false,
    };

    const scope2: QueryScopeEntry = {
      key: 'ef567890',
      label: 'src/parser',
      language: 'typescript',
      kind: 'derived',
      sources: ['src/parser'],
      entityCount: 10,
      relationCount: 5,
      hasAtlasExtension: false,
    };

    const manifest: QueryManifest = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      scopes: [scope1, scope2],
    };

    expect(manifest.scopes).toHaveLength(2);
    expect(manifest.scopes[0].kind).toBe('parsed');
    expect(manifest.scopes[1].kind).toBe('derived');
  });

  it('should allow hasAtlasExtension to be true', () => {
    const scope: QueryScopeEntry = {
      key: '1a2b3c4d',
      label: 'cmd/server',
      language: 'go',
      kind: 'parsed',
      sources: ['cmd/server'],
      entityCount: 100,
      relationCount: 50,
      hasAtlasExtension: true,
    };

    expect(scope.hasAtlasExtension).toBe(true);
    expect(scope.language).toBe('go');
  });
});

describe('QuerySourceGroup type', () => {
  it('should hold an ArchJSON reference', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles: ['src/cli/index.ts'],
      entities: [
        {
          id: 'CLI',
          name: 'CLI',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: 'src/cli/index.ts', startLine: 1, endLine: 50 },
        },
      ],
      relations: [],
    };

    const group: QuerySourceGroup = {
      key: 'aabb1122',
      sources: ['src/cli'],
      archJson,
      kind: 'parsed',
    };

    expect(group.archJson.entities).toHaveLength(1);
    expect(group.archJson.entities[0].name).toBe('CLI');
    expect(group.kind).toBe('parsed');
  });
});
