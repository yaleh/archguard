import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readModuleName } from '@/plugins/golang/go-mod-reader.js';

vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

import fs from 'fs-extra';

describe('readModuleName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns module name from valid go.mod', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      'module github.com/example/myapp\n\ngo 1.21\n' as never
    );
    const result = await readModuleName('/workspace');
    expect(result).toBe('github.com/example/myapp');
  });

  it('returns unknown when go.mod is missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT') as never);
    const result = await readModuleName('/workspace');
    expect(result).toBe('unknown');
  });

  it('returns unknown when module declaration is absent', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('go 1.21\n' as never);
    const result = await readModuleName('/workspace');
    expect(result).toBe('unknown');
  });
});
