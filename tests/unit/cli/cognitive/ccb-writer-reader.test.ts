/**
 * Unit tests for CCB writer and reader.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CognitiveContextBundle } from '@/cli/cognitive/ccb-schema.js';

const mockOutputFile = vi.fn();
const mockMove = vi.fn();
const mockEnsureDir = vi.fn();
const mockReadFile = vi.fn();

vi.mock('fs-extra', () => ({
  default: {
    outputFile: (...args: unknown[]) => mockOutputFile(...args),
    move: (...args: unknown[]) => mockMove(...args),
    ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  outputFile: (...args: unknown[]) => mockOutputFile(...args),
  move: (...args: unknown[]) => mockMove(...args),
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

const mockCreateHash = vi.fn();
vi.mock('crypto', () => ({
  default: {
    createHash: (...args: unknown[]) => mockCreateHash(...args),
  },
  createHash: (...args: unknown[]) => mockCreateHash(...args),
}));

const mockBundle: CognitiveContextBundle = {
  fileId: 'src-cli-query-query-engine',
  filePath: 'src/cli/query/query-engine.ts',
  fileHash: 'abc123def456',
  assembledAt: '2026-06-22T00:00:00.000Z',
  structural: null,
  behavioral: null,
  git: null,
  guidance: null,
};

describe('ccb-writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDir.mockResolvedValue(undefined);
    mockOutputFile.mockResolvedValue(undefined);
    mockMove.mockResolvedValue(undefined);
  });

  it('writes bundle to correct path', async () => {
    const { writeCcb } = await import('@/cli/cognitive/ccb-writer.js');
    await writeCcb(mockBundle, '/tmp/arch');

    expect(mockOutputFile).toHaveBeenCalled();
    const callArgs = mockOutputFile.mock.calls[0];
    const writtenPath = callArgs[0] as string;
    expect(writtenPath).toMatch(/\.tmp$/);
    expect(writtenPath).toContain(mockBundle.fileId);
    expect(writtenPath).toContain('.ccb.json');

    // The final path after move should be correct
    expect(mockMove).toHaveBeenCalled();
    const moveDest = (mockMove.mock.calls[0] as string[])[1];
    expect(moveDest).toContain(mockBundle.fileId + '.ccb.json');
  });

  it('uses atomic write (tmp then rename)', async () => {
    const { writeCcb } = await import('@/cli/cognitive/ccb-writer.js');
    await writeCcb(mockBundle, '/tmp/arch');

    // Should write to .tmp path first
    const tmpPath = (mockOutputFile.mock.calls[0] as string[])[0];
    expect(tmpPath).toMatch(/\.tmp$/);

    // Then move to final path
    const [moveFrom, moveTo] = mockMove.mock.calls[0] as string[];
    expect(moveFrom).toBe(tmpPath);
    expect(moveTo).not.toMatch(/\.tmp$/);
    expect(moveTo).toMatch(/\.ccb\.json$/);
  });
});

describe('ccb-reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stale:false when hash matches', async () => {
    const storedBundle = { ...mockBundle };
    mockReadFile.mockResolvedValue(JSON.stringify(storedBundle));

    const digestFn = vi.fn().mockReturnValue(mockBundle.fileHash);
    const updateFn = vi.fn().mockReturnValue({ digest: digestFn });
    mockCreateHash.mockReturnValue({ update: updateFn });

    const { readCcb } = await import('@/cli/cognitive/ccb-reader.js');
    const result = await readCcb(mockBundle.fileId, mockBundle.filePath, '/tmp/arch');

    expect(result.stale).toBe(false);
    expect(result.bundle).toEqual(storedBundle);
  });

  it('returns stale:true when hash mismatches', async () => {
    const storedBundle = { ...mockBundle, fileHash: 'oldhash' };
    mockReadFile.mockResolvedValue(JSON.stringify(storedBundle));

    const digestFn = vi.fn().mockReturnValue('newhash');
    const updateFn = vi.fn().mockReturnValue({ digest: digestFn });
    mockCreateHash.mockReturnValue({ update: updateFn });

    const { readCcb } = await import('@/cli/cognitive/ccb-reader.js');
    const result = await readCcb(mockBundle.fileId, mockBundle.filePath, '/tmp/arch');

    expect(result.stale).toBe(true);
    expect(result.bundle).toBeNull();
  });

  it('returns stale:true when no CCB file exists', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);

    const { readCcb } = await import('@/cli/cognitive/ccb-reader.js');
    const result = await readCcb(mockBundle.fileId, mockBundle.filePath, '/tmp/arch');

    expect(result.stale).toBe(true);
    expect(result.bundle).toBeNull();
  });
});
