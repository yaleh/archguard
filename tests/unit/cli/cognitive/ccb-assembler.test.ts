/**
 * Unit tests for CCB assembler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CognitiveContextBundle } from '@/cli/cognitive/ccb-schema.js';
import type { CcbReadResult } from '@/cli/cognitive/ccb-reader.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReadCcb = vi.fn<() => Promise<CcbReadResult>>();
const mockWriteCcb = vi.fn<() => Promise<void>>();

vi.mock('@/cli/cognitive/ccb-reader.js', () => ({
  readCcb: (...args: unknown[]) => mockReadCcb(...(args as [])),
}));

vi.mock('@/cli/cognitive/ccb-writer.js', () => ({
  writeCcb: (...args: unknown[]) => mockWriteCcb(...(args as [])),
}));

// Mock loadEngine for structural data
const mockLoadEngine = vi.fn();
vi.mock('@/cli/query/engine-loader.js', () => ({
  loadEngine: (...args: unknown[]) => mockLoadEngine(...args),
}));

// Mock history loader
const mockLoadHistoryData = vi.fn();
vi.mock('@/cli/git-history/history-loader.js', () => ({
  loadHistoryData: (...args: unknown[]) => mockLoadHistoryData(...args),
}));

// Mock fs-extra for hash computation
const mockFsReadFile = vi.fn();
vi.mock('fs-extra', () => ({
  default: {
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
  },
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
}));

// Mock crypto
const mockDigest = vi.fn().mockReturnValue('deadbeef1234');
const mockUpdate = vi.fn().mockReturnValue({ digest: mockDigest });
const mockCreateHash = vi.fn().mockReturnValue({ update: mockUpdate });
vi.mock('crypto', () => ({
  default: { createHash: (...args: unknown[]) => mockCreateHash(...args) },
  createHash: (...args: unknown[]) => mockCreateHash(...args),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockBundle: CognitiveContextBundle = {
  fileId: 'src-cli-query-query-engine',
  filePath: 'src/cli/query/query-engine.ts',
  fileHash: 'deadbeef1234',
  assembledAt: '2026-06-22T00:00:00.000Z',
  structural: {
    name: 'QueryEngine',
    found: true,
    entityId: 'foo',
    methodCount: 5,
    fieldCount: 2,
    inDegree: 3,
    outDegree: 4,
    topDependents: [],
    topDependencies: [],
  },
  behavioral: null,
  git: null,
  guidance: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteCcb.mockResolvedValue(undefined);
  mockFsReadFile.mockResolvedValue('file-content');
  mockLoadHistoryData.mockRejectedValue(new Error('no git'));
});

describe('ccb-assembler', () => {
  it('returns cached bundle when not stale', async () => {
    mockReadCcb.mockResolvedValue({ bundle: mockBundle, stale: false });

    const { assembleCcb } = await import('@/cli/cognitive/ccb-assembler.js');
    const result = await assembleCcb(
      'src-cli-query-query-engine',
      'src/cli/query/query-engine.ts',
      '/tmp/arch'
    );

    expect(result).toEqual(mockBundle);
    // Should not fetch structural data or write
    expect(mockLoadEngine).not.toHaveBeenCalled();
    expect(mockWriteCcb).not.toHaveBeenCalled();
  });

  it('reassembles when stale', async () => {
    mockReadCcb.mockResolvedValue({ bundle: null, stale: true });
    // Provide a mock engine that returns no entity found
    mockLoadEngine.mockResolvedValue({
      engine: { findEntity: vi.fn().mockReturnValue([]) },
      extensionAccessor: { hasTestAnalysis: vi.fn().mockReturnValue(false) },
      relationQueryService: {},
    });

    const { assembleCcb } = await import('@/cli/cognitive/ccb-assembler.js');
    const result = await assembleCcb(
      'src-cli-query-query-engine',
      'src/cli/query/query-engine.ts',
      '/tmp/arch'
    );

    expect(mockWriteCcb).toHaveBeenCalled();
    expect(result.fileId).toBe('src-cli-query-query-engine');
    expect(result.fileHash).toBe('deadbeef1234');
  });

  it('sets behavioral:null when meta-cc unavailable', async () => {
    mockReadCcb.mockResolvedValue({ bundle: null, stale: true });
    mockLoadEngine.mockResolvedValue({
      engine: { findEntity: vi.fn().mockReturnValue([]) },
      extensionAccessor: { hasTestAnalysis: vi.fn().mockReturnValue(false) },
      relationQueryService: {},
    });

    const { assembleCcb } = await import('@/cli/cognitive/ccb-assembler.js');
    const result = await assembleCcb(
      'src-cli-query-query-engine',
      'src/cli/query/query-engine.ts',
      '/tmp/arch'
    );

    expect(result.behavioral).toBeNull();
  });

  it('forceRefresh bypasses cache even when not stale', async () => {
    mockReadCcb.mockResolvedValue({ bundle: mockBundle, stale: false });
    mockLoadEngine.mockResolvedValue({
      engine: { findEntity: vi.fn().mockReturnValue([]) },
      extensionAccessor: { hasTestAnalysis: vi.fn().mockReturnValue(false) },
      relationQueryService: {},
    });

    const { assembleCcb } = await import('@/cli/cognitive/ccb-assembler.js');
    await assembleCcb('src-cli-query-query-engine', 'src/cli/query/query-engine.ts', '/tmp/arch', {
      forceRefresh: true,
    });

    // Should have fetched fresh data despite non-stale cache
    expect(mockLoadEngine).toHaveBeenCalled();
    expect(mockWriteCcb).toHaveBeenCalled();
  });

  it('sets git:null when git artifacts absent', async () => {
    mockReadCcb.mockResolvedValue({ bundle: null, stale: true });
    mockLoadEngine.mockResolvedValue({
      engine: { findEntity: vi.fn().mockReturnValue([]) },
      extensionAccessor: { hasTestAnalysis: vi.fn().mockReturnValue(false) },
      relationQueryService: {},
    });
    mockLoadHistoryData.mockRejectedValue(new Error('git artifacts absent'));

    const { assembleCcb } = await import('@/cli/cognitive/ccb-assembler.js');
    const result = await assembleCcb(
      'src-cli-query-query-engine',
      'src/cli/query/query-engine.ts',
      '/tmp/arch'
    );

    expect(result.git).toBeNull();
  });
});
