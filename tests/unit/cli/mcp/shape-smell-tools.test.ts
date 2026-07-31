/**
 * Phase C: MCP tool tests for shape-smell tools.
 *
 * Mocks the detector and persistence layer; tests tool registration
 * and handler behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Mocks — must be before imports that use mocked modules
// ---------------------------------------------------------------------------

vi.mock('@/analysis/shape-smells/literal-dispersion.js', () => ({
  extractDiscriminatorTypes: vi.fn(),
  detectDispersion: vi.fn(),
}));

vi.mock('@/analysis/shape-smells/persistence.js', () => ({
  persistResults: vi.fn(),
  loadLiteralDispersion: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(''),
    pathExists: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('glob', () => ({
  globSync: vi.fn(),
}));

import { registerShapeSmellTools } from '@/cli/mcp/tools/shape-smell-tools.js';
import { detectDispersion } from '@/analysis/shape-smells/literal-dispersion.js';
import { persistResults, loadLiteralDispersion } from '@/analysis/shape-smells/persistence.js';
import type { LiteralDispersionSmell } from '@/analysis/shape-smells/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSmells(): LiteralDispersionSmell[] {
  return [
    {
      typeName: 'AppKind',
      value: 'web',
      files: ['src/capture/index.ts', 'src/types.ts'],
      dispersion: 2,
      severity: 'info',
      locations: [
        { file: 'src/capture/index.ts', line: 10 },
        { file: 'src/types.ts', line: 1 },
      ],
    },
    {
      typeName: 'AppKind',
      value: 'mobile',
      files: ['src/capture/index.ts', 'src/query/index.ts', 'src/types.ts'],
      dispersion: 3,
      severity: 'warning',
      locations: [
        { file: 'src/capture/index.ts', line: 15 },
        { file: 'src/query/index.ts', line: 5 },
        { file: 'src/types.ts', line: 2 },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Helper: register tools and collect handler functions
// ---------------------------------------------------------------------------

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return undefined as unknown as ReturnType<McpServer['tool']>;
  });

  registerShapeSmellTools(server, defaultRoot);
  return tools;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shape-smell MCP tools', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- archguard_detect_shape_smells ----

  describe('archguard_detect_shape_smells', () => {
    it('registers the tool successfully', () => {
      const tools = collectTools(server);
      expect(tools.has('archguard_detect_shape_smells')).toBe(true);
    });

    it('returns empty result when no smells detected', async () => {
      vi.mocked(detectDispersion).mockReturnValue([]);

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        layers: ['literal-dispersion'],
        sources: ['/workspace/src/a.ts'],
        dispersionThreshold: 2,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.manifest.totalSmells).toBe(0);
      expect(parsed.manifest.bySeverity).toEqual({ info: 0, warning: 0 });
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].layer).toBe('literal-dispersion');
      expect(parsed.results[0].smells).toEqual([]);
    });

    it('returns dispersion results for literal-dispersion layer', async () => {
      vi.mocked(detectDispersion).mockReturnValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        layers: ['literal-dispersion'],
        sources: ['/workspace/src/a.ts'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.manifest.totalSmells).toBe(2);
      expect(parsed.manifest.bySeverity.info).toBe(1);
      expect(parsed.manifest.bySeverity.warning).toBe(1);
      expect(parsed.results[0].smells).toHaveLength(2);
    });

    it('defaults to literal-dispersion only when no layers param', async () => {
      vi.mocked(detectDispersion).mockReturnValue([]);

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        sources: ['/workspace/src/a.ts'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].layer).toBe('literal-dispersion');
    });

    it('returns empty + diagnostic for hidden-coupling layer (never throws)', async () => {
      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        layers: ['hidden-coupling'],
        sources: ['/workspace/src/a.ts'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.manifest.totalSmells).toBe(0);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].layer).toBe('hidden-coupling');
      expect(parsed.results[0].smells).toEqual([]);
      expect(parsed.results[0].diagnostic).toBeTruthy();
      expect(parsed.results[0].diagnostic).toContain('not yet implemented');
    });

    it('returns empty + diagnostic for enum-extension-impact layer (never throws)', async () => {
      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        layers: ['enum-extension-impact'],
        sources: ['/workspace/src/a.ts'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].layer).toBe('enum-extension-impact');
      expect(parsed.results[0].smells).toEqual([]);
      expect(parsed.results[0].diagnostic).toContain('not yet implemented');
    });

    it('forwards dispersionThreshold to detector (default 2)', async () => {
      vi.mocked(detectDispersion).mockReturnValue([]);

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      await handler({
        projectRoot: '/workspace',
        layers: ['literal-dispersion'],
        sources: ['/workspace/src/a.ts'],
        dispersionThreshold: 5,
      });

      expect(detectDispersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ threshold: 5 })
      );
    });

    it('includes summary counts (total + by-severity)', async () => {
      vi.mocked(detectDispersion).mockReturnValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      const result = await handler({
        projectRoot: '/workspace',
        layers: ['literal-dispersion'],
        sources: ['/workspace/src/a.ts'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.manifest.totalSmells).toBe(2);
      expect(parsed.manifest.bySeverity).toEqual({ info: 1, warning: 1 });
    });

    it('calls persistResults after detection', async () => {
      vi.mocked(detectDispersion).mockReturnValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_detect_shape_smells');

      await handler({
        projectRoot: '/workspace',
        layers: ['literal-dispersion'],
        sources: ['/workspace/src/a.ts'],
      });

      expect(persistResults).toHaveBeenCalled();
    });
  });

  // ---- archguard_get_literal_dispersion ----

  describe('archguard_get_literal_dispersion', () => {
    it('registers the tool successfully', () => {
      const tools = collectTools(server);
      expect(tools.has('archguard_get_literal_dispersion')).toBe(true);
    });

    it('returns all smells when no filters applied', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({ projectRoot: '/workspace' });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toHaveLength(2);
    });

    it('returns empty with note when no persisted data', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(null);

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({ projectRoot: '/workspace' });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toEqual([]);
      expect(parsed.note).toBeTruthy();
    });

    it('filters by typeName', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({
        projectRoot: '/workspace',
        typeName: 'AppKind',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toHaveLength(2);
      // All smells have typeName 'AppKind'
    });

    it('filters by value', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({
        projectRoot: '/workspace',
        value: 'web',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toHaveLength(1);
      expect(parsed.smells[0].value).toBe('web');
    });

    it('filters by minDispersion', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({
        projectRoot: '/workspace',
        minDispersion: 3,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toHaveLength(1);
      expect(parsed.smells[0].value).toBe('mobile');
      expect(parsed.smells[0].dispersion).toBe(3);
    });

    it('combines multiple filters', async () => {
      vi.mocked(loadLiteralDispersion).mockResolvedValue(makeSmells());

      const tools = collectTools(server, '/workspace');
      const handler = tools.get('archguard_get_literal_dispersion');

      const result = await handler({
        projectRoot: '/workspace',
        typeName: 'AppKind',
        value: 'mobile',
        minDispersion: 2,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.smells).toHaveLength(1);
      expect(parsed.smells[0].value).toBe('mobile');
    });
  });
});
