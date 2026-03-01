/**
 * Unit tests for ProjectStructureDetector
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock fs-extra before importing the module under test
vi.mock('fs-extra', () => ({
  default: {
    stat: vi.fn(),
    readdir: vi.fn(),
  },
}));

import fs from 'fs-extra';
import {
  findSourceRoot,
  getTopLevelModules,
  detectProjectStructure,
} from '@/cli/utils/project-structure-detector.js';

const mockStat = vi.mocked(fs.stat) as unknown as ReturnType<typeof vi.fn>;
const mockReaddir = vi.mocked(fs.readdir) as unknown as ReturnType<typeof vi.fn>;

/** Helper: create a mock Dirent */
function makeDirent(name: string, isDirectory: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: '',
    path: '',
  } as unknown as fs.Dirent;
}

/** Helper: create a mock Dirent for a .ts file */
function makeTsFile(name: string): fs.Dirent {
  return makeDirent(name, false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findSourceRoot
// ---------------------------------------------------------------------------

describe('findSourceRoot', () => {
  it('returns ./src when src/ exists', async () => {
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('/src')) return Promise.resolve({ isDirectory: () => true });
      return Promise.reject(new Error('not found'));
    });

    const result = await findSourceRoot('/project');
    expect(result).toBe('./src');
  });

  it('returns ./lib when only lib/ exists', async () => {
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('/lib')) return Promise.resolve({ isDirectory: () => true });
      return Promise.reject(new Error('not found'));
    });

    const result = await findSourceRoot('/project');
    expect(result).toBe('./lib');
  });

  it('returns ./app when only app/ exists', async () => {
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('/app')) return Promise.resolve({ isDirectory: () => true });
      return Promise.reject(new Error('not found'));
    });

    const result = await findSourceRoot('/project');
    expect(result).toBe('./app');
  });

  it('prefers src over lib when both exist', async () => {
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('/src') || p.endsWith('/lib')) {
        return Promise.resolve({ isDirectory: () => true });
      }
      return Promise.reject(new Error('not found'));
    });

    const result = await findSourceRoot('/project');
    expect(result).toBe('./src');
  });

  it('falls back to ./ when no known source root exists', async () => {
    mockStat.mockRejectedValue(new Error('not found'));

    const result = await findSourceRoot('/project');
    expect(result).toBe('./');
  });
});

// ---------------------------------------------------------------------------
// getTopLevelModules
// ---------------------------------------------------------------------------

describe('getTopLevelModules', () => {
  it('returns module names that have .ts files', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        // first call: top-level readdir → subdirectories
        makeDirent('cli', true),
        makeDirent('parser', true),
      ])
      // subsequent calls: readdir inside each module
      .mockResolvedValueOnce([makeTsFile('index.ts')])
      .mockResolvedValueOnce([makeTsFile('parser.ts')]);

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).toEqual(['cli', 'parser']);
  });

  it('excludes known noise directories', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('src', true),
        makeDirent('node_modules', true),
        makeDirent('dist', true),
        makeDirent('tests', true),
        makeDirent('build', true),
        makeDirent('coverage', true),
        makeDirent('.git', true),
        makeDirent('__tests__', true),
        makeDirent('cli', true),
      ])
      // only 'cli' passes the filter; src actually in root so won't get here normally
      // but here src is treated as a module name — we just need cli to pass
      .mockResolvedValue([makeTsFile('index.ts')]);

    const modules = await getTopLevelModules('/project', './');
    // Only 'cli' should pass (src is not excluded but we check it too)
    expect(modules).not.toContain('node_modules');
    expect(modules).not.toContain('dist');
    expect(modules).not.toContain('tests');
    expect(modules).not.toContain('build');
    expect(modules).not.toContain('coverage');
    expect(modules).not.toContain('.git');
    expect(modules).not.toContain('__tests__');
    expect(modules).toContain('cli');
  });

  it('excludes directories with no .ts or .js files', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('empty-module', true),
        makeDirent('real-module', true),
      ])
      .mockResolvedValueOnce([makeDirent('README.md', false)]) // empty-module: no .ts
      .mockResolvedValueOnce([makeTsFile('index.ts')]); // real-module: has .ts

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).toEqual(['real-module']);
  });

  it('excludes directories starting with dot', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('.cache', true),
        makeDirent('cli', true),
      ])
      .mockResolvedValueOnce([makeTsFile('index.ts')]);

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).not.toContain('.cache');
    expect(modules).toContain('cli');
  });

  it('returns sorted module names', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('utils', true),
        makeDirent('cli', true),
        makeDirent('parser', true),
      ])
      .mockResolvedValue([makeTsFile('index.ts')]);

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).toEqual(['cli', 'parser', 'utils']);
  });

  it('returns [] when readdir fails', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).toEqual([]);
  });

  it('detects .js files as source files', async () => {
    mockReaddir
      .mockResolvedValueOnce([makeDirent('lib', true)])
      .mockResolvedValueOnce([makeDirent('index.js', false)]);

    const modules = await getTopLevelModules('/project', './src');
    expect(modules).toContain('lib');
  });
});

// ---------------------------------------------------------------------------
// detectProjectStructure
// ---------------------------------------------------------------------------

describe('detectProjectStructure', () => {
  it('returns single diagram when fewer than 2 modules found', async () => {
    // findSourceRoot → src exists
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);

    // getTopLevelModules → only one module
    mockReaddir
      .mockResolvedValueOnce([makeDirent('cli', true)])
      .mockResolvedValueOnce([makeTsFile('index.ts')]);

    const diagrams = await detectProjectStructure('/project');

    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]).toEqual({
      name: 'architecture',
      sources: ['./src'],
      level: 'class',
    });
  });

  it('returns single diagram when no modules found', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReaddir.mockResolvedValueOnce([]); // no subdirectories

    const diagrams = await detectProjectStructure('/project');

    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].name).toBe('architecture');
  });

  it('returns three-layer diagram set when 2+ modules found', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);

    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('cli', true),
        makeDirent('parser', true),
        makeDirent('utils', true),
      ])
      .mockResolvedValue([makeTsFile('index.ts')]);

    const diagrams = await detectProjectStructure('/project');

    // overview/package + class/all-classes + 3 method diagrams
    expect(diagrams).toHaveLength(5);
    expect(diagrams[0]).toMatchObject({ name: 'overview/package', level: 'package', sources: ['./src'] });
    expect(diagrams[1]).toMatchObject({ name: 'class/all-classes', level: 'class', sources: ['./src'] });
    expect(diagrams[2]).toMatchObject({ name: 'method/cli', level: 'method', sources: ['./src/cli'] });
    expect(diagrams[3]).toMatchObject({ name: 'method/parser', level: 'method', sources: ['./src/parser'] });
    expect(diagrams[4]).toMatchObject({ name: 'method/utils', level: 'method', sources: ['./src/utils'] });
  });

  it('uses correct source root in method diagram sources', async () => {
    // lib/ exists, not src/
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('/lib')) return Promise.resolve({ isDirectory: () => true } as any);
      return Promise.reject(new Error('not found'));
    });

    mockReaddir
      .mockResolvedValueOnce([makeDirent('core', true), makeDirent('api', true)])
      .mockResolvedValue([makeTsFile('index.ts')]);

    const diagrams = await detectProjectStructure('/project');

    expect(diagrams[0].sources).toEqual(['./lib']);
    expect(diagrams[2]).toMatchObject({ name: 'method/api', sources: ['./lib/api'] });
  });

  it('falls back to ./ source root when no standard directory found', async () => {
    mockStat.mockRejectedValue(new Error('not found'));

    mockReaddir
      .mockResolvedValueOnce([makeDirent('core', true), makeDirent('api', true)])
      .mockResolvedValue([makeTsFile('index.ts')]);

    const diagrams = await detectProjectStructure('/project');

    expect(diagrams[0].sources).toEqual(['./']);
  });
});
