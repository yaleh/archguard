/**
 * Unit tests for OutputPathResolver.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

const mockMkdir = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', () => ({
  default: { mkdir: (...args: unknown[]) => mockMkdir(...args) },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';

describe('OutputPathResolver', () => {
  beforeEach(() => {
    mockMkdir.mockClear();
    mockMkdir.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('resolves using config.outputDir by default', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve();
    expect(result.outputDir).toBe(path.resolve('/out'));
    expect(result.baseName).toBe('architecture');
    expect(result.paths.mmd).toBe(path.join(path.resolve('/out'), 'architecture.mmd'));
    expect(result.paths.png).toContain('.png');
    expect(result.paths.svg).toContain('.svg');
    expect(result.paths.json).toContain('.json');
  });

  it('prefers options.output over everything', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: '/cfg/out' });
    const result = resolver.resolve({ output: '/custom/dir/name' });
    expect(result.outputDir).toBe(path.resolve('/custom/dir'));
    expect(result.baseName).toBe('name');
  });

  it('supports options.name with subdirectory', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve({ name: 'frontend/api' });
    expect(result.outputDir).toBe(path.resolve(path.join('/out', 'frontend')));
    expect(result.baseName).toBe('api');
    expect(result.paths.mmd).toBe(path.join(path.resolve('/out/frontend'), 'api.mmd'));
  });

  it('supports trailing slash in custom name', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve({ name: 'frontend/' });
    expect(result.outputDir).toBe(path.resolve(path.join('/out', 'frontend')));
    expect(result.baseName).toBe('architecture');
  });

  it('supports options.baseName alias', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve({ baseName: 'arch' });
    expect(result.baseName).toBe('arch');
    expect(result.paths.json).toBe(path.join(path.resolve('/out'), 'arch.json'));
  });

  it('uses config.output when no option overrides it', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: '/cfg-out/arch' });
    const result = resolver.resolve();
    expect(result.outputDir).toBe(path.resolve('/cfg-out'));
    expect(result.baseName).toBe('arch');
  });

  it('handles output path with extension', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve({ output: './dir/name.png' });
    expect(result.baseName).toBe('name');
  });

  it('handles output path with trailing slash', () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    const result = resolver.resolve({ output: '/dir/' });
    expect(result.baseName).toBe('architecture');
  });

  it('ensureDirectory creates the output directory', async () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    await resolver.ensureDirectory();
    expect(mockMkdir).toHaveBeenCalledWith(path.resolve('/out'), { recursive: true });
  });

  it('ensureDirectory resolves subdirectory paths', async () => {
    const resolver = new OutputPathResolver({ outputDir: '/out', output: undefined });
    await resolver.ensureDirectory({ name: 'sub/dir' });
    // 'sub/dir' flattens to outputDir=/out/sub with baseName=dir
    expect(mockMkdir).toHaveBeenCalledWith(path.resolve(path.join('/out', 'sub')), { recursive: true });
  });
});
