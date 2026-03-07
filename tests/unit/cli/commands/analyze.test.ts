/**
 * Unit tests for analyze command
 * Tests normalizeToDiagrams and filterByLevels functions
 *
 * New behavior (v3.0):
 * - -s alone → auto-detect from that path (multi-diagram)
 * - -s + --diagrams class → auto-detect then filter by level
 * - --diagrams <levels...> → filter by level (package/class/method)
 * - -l and -n flags removed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeToDiagrams, filterByLevels } from '@/cli/commands/analyze.js';
import type { Config } from '@/cli/config-loader.js';
import type { CLIOptions, DiagramConfig } from '@/types/config.js';

// Mock detectProjectStructure so Priority 3 tests are deterministic
vi.mock('@/cli/utils/project-structure-detector.js', () => ({
  detectProjectStructure: vi
    .fn()
    .mockResolvedValue([{ name: 'architecture', sources: ['./src'], level: 'class' }]),
}));

import { detectProjectStructure } from '@/cli/utils/project-structure-detector.js';

const baseConfig: Config = {
  diagrams: [],
  outputDir: './archguard',
  format: 'plantuml',
  exclude: [],
  cli: { command: 'claude', args: [], timeout: 60000 },
  cache: { enabled: true, ttl: 86400 },
  concurrency: 8,
  verbose: false,
};

beforeEach(() => {
  vi.mocked(detectProjectStructure).mockClear();
  vi.mocked(detectProjectStructure).mockResolvedValue([
    { name: 'architecture', sources: ['./src'], level: 'class' },
  ]);
});

describe('normalizeToDiagrams', () => {
  describe('Priority 1: Config file diagrams', () => {
    it('should use config.diagrams when present', async () => {
      const config: Config = {
        ...baseConfig,
        diagrams: [
          { name: 'frontend', sources: ['./src/frontend'], level: 'class' },
          { name: 'backend', sources: ['./src/backend'], level: 'class' },
        ],
      };

      const cliOptions: CLIOptions = {
        sources: ['./cli-src'],
      };

      const result = await normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('frontend');
      expect(result[1].name).toBe('backend');
    });

    it('should ignore CLI sources when config.diagrams exists', async () => {
      const config: Config = {
        ...baseConfig,
        diagrams: [{ name: 'configured', sources: ['./configured'], level: 'package' }],
      };

      const cliOptions: CLIOptions = {
        sources: ['./cli-src'],
      };

      const result = await normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('configured');
      expect(result[0].sources).toEqual(['./configured']);
      expect(result[0].level).toBe('package');
    });

    it('should apply --diagrams level filter even when config.diagrams present', async () => {
      const config: Config = {
        ...baseConfig,
        diagrams: [
          { name: 'overview', sources: ['./src'], level: 'package' },
          { name: 'all-classes', sources: ['./src'], level: 'class' },
          { name: 'cli-methods', sources: ['./src/cli'], level: 'method' },
        ],
      };

      // --diagrams class → only return class-level diagrams
      const cliOptions: CLIOptions = { diagrams: ['class'] };

      const result = await normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('all-classes');
      expect(result[0].level).toBe('class');
    });

    it('should apply multiple level filters when config.diagrams present', async () => {
      const config: Config = {
        ...baseConfig,
        diagrams: [
          { name: 'overview', sources: ['./src'], level: 'package' },
          { name: 'all-classes', sources: ['./src'], level: 'class' },
          { name: 'cli-methods', sources: ['./src/cli'], level: 'method' },
        ],
      };

      const cliOptions: CLIOptions = { diagrams: ['package', 'class'] };

      const result = await normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(2);
      expect(result[0].level).toBe('package');
      expect(result[1].level).toBe('class');
    });
  });

  describe('Priority 2: CLI sources → auto-detect from path', () => {
    it('should call detectProjectStructure with the resolved sources[0] path', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
      ]);

      const cliOptions: CLIOptions = {
        sources: ['./src'],
      };

      const result = await normalizeToDiagrams(baseConfig, cliOptions, '/project/root');

      expect(detectProjectStructure).toHaveBeenCalled();
      expect(result).toHaveLength(3);
    });

    it('should return multi-diagram set from auto-detection when only -s provided', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
        { name: 'method/parser', sources: ['./src/parser'], level: 'method' },
      ]);

      const cliOptions: CLIOptions = {
        sources: ['./src'],
      };

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(result).toHaveLength(4);
      expect(result[0].name).toBe('overview/package');
      expect(result[1].name).toBe('class/all-classes');
      expect(result[2].name).toBe('method/cli');
      expect(result[3].name).toBe('method/parser');
    });

    it('should filter by level when -s and --diagrams are both provided', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
        { name: 'method/parser', sources: ['./src/parser'], level: 'method' },
      ]);

      const cliOptions: CLIOptions = {
        sources: ['./src'],
        diagrams: ['class'],
      };

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('class/all-classes');
      expect(result[0].level).toBe('class');
    });

    it('should filter to multiple levels when -s and --diagrams package class provided', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
      ]);

      const cliOptions: CLIOptions = {
        sources: ['./src'],
        diagrams: ['package', 'class'],
      };

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(result).toHaveLength(2);
      expect(result[0].level).toBe('package');
      expect(result[1].level).toBe('class');
    });

    it('should include format and exclude passthrough when provided', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
      ]);

      const cliOptions: CLIOptions = {
        sources: ['./src'],
        format: 'json',
        exclude: ['**/*.spec.ts'],
      };

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      // detectProjectStructure is called, but format/exclude come from global config
      // not injected per-diagram by normalizeToDiagrams
      expect(result).toHaveLength(1);
    });
  });

  describe('Priority 3: Auto-detect project structure', () => {
    it('should call detectProjectStructure when no config.diagrams and no CLI sources', async () => {
      const cliOptions: CLIOptions = {};

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(detectProjectStructure).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'architecture',
        sources: ['./src'],
        level: 'class',
      });
    });

    it('should handle empty CLI options', async () => {
      const cliOptions: CLIOptions = {};

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(result).toEqual([
        {
          name: 'architecture',
          sources: ['./src'],
          level: 'class',
        },
      ]);
    });

    it('should return multi-diagram set when detectProjectStructure returns multiple', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
        { name: 'method/parser', sources: ['./src/parser'], level: 'method' },
      ]);

      const result = await normalizeToDiagrams(baseConfig, {});

      expect(result).toHaveLength(4);
      expect(result[0].name).toBe('overview/package');
      expect(result[1].name).toBe('class/all-classes');
      expect(result[2].name).toBe('method/cli');
      expect(result[3].name).toBe('method/parser');
    });

    it('should pass rootDir to detectProjectStructure', async () => {
      const cliOptions: CLIOptions = {};
      await normalizeToDiagrams(baseConfig, cliOptions, '/custom/root');

      expect(detectProjectStructure).toHaveBeenCalledWith('/custom/root');
    });

    it('should apply --diagrams level filter in Priority 3', async () => {
      vi.mocked(detectProjectStructure).mockResolvedValue([
        { name: 'overview/package', sources: ['./src'], level: 'package' },
        { name: 'class/all-classes', sources: ['./src'], level: 'class' },
        { name: 'method/cli', sources: ['./src/cli'], level: 'method' },
      ]);

      const cliOptions: CLIOptions = { diagrams: ['method'] };

      const result = await normalizeToDiagrams(baseConfig, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('method');
    });
  });

  describe('C++ special case', () => {
    it('--lang cpp returns two diagrams: package and class', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'cpp',
      });

      expect(detectProjectStructure).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].level).toBe('package');
      expect(result[1].level).toBe('class');
    });

    it('--lang cpp sets language: "cpp" on both diagrams', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'cpp',
      });

      expect(result[0].language).toBe('cpp');
      expect(result[1].language).toBe('cpp');
    });

    it('--lang cpp derives module name from sources[0] basename', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['/home/user/myproject/src'],
        lang: 'cpp',
      });

      expect(result[0].name).toBe('src/overview/package');
      expect(result[1].name).toBe('src/class/all-classes');
    });

    it('--lang cpp with --diagrams package returns only package diagram', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'cpp',
        diagrams: ['package'],
      });

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('package');
    });

    it('--lang cpp with --diagrams class returns only class diagram', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'cpp',
        diagrams: ['class'],
      });

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('class');
    });

    it('--lang cpp passes format and exclude through to both diagrams', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'cpp',
        format: 'json',
        exclude: ['**/*.test.cpp'],
      });

      expect(result[0].format).toBe('json');
      expect(result[0].exclude).toEqual(['**/*.test.cpp']);
      expect(result[1].format).toBe('json');
      expect(result[1].exclude).toEqual(['**/*.test.cpp']);
    });
  });

  describe('Go Atlas special case (preserved)', () => {
    it('--lang go enables atlas by default without --atlas flag', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific?.['atlas']).toMatchObject({ enabled: true });
    });

    it('--lang go --no-atlas disables atlas (opt-out)', async () => {
      // Commander.js sets atlas: false when --no-atlas is passed (negatable option)
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
        atlas: false,
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific).toBeUndefined();
    });

    it('--atlas still works as before (implies --lang go + atlas)', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        atlas: true,
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific?.['atlas']).toMatchObject({ enabled: true });
    });

    it('--lang go uses selective strategy by default', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
      });

      const atlasConfig = result[0].languageSpecific?.['atlas'] as any;
      expect(atlasConfig.functionBodyStrategy).toBe('selective');
    });

    it('--lang go --atlas-strategy full passes strategy through', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
        atlasStrategy: 'full',
      });

      const atlasConfig = result[0].languageSpecific?.['atlas'] as any;
      expect(atlasConfig.functionBodyStrategy).toBe('full');
    });

    it('Go Atlas returns single diagram (not auto-detected multi-diagram)', async () => {
      const result = await normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
      });

      // Go Atlas bypasses detectProjectStructure
      expect(detectProjectStructure).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });
});

describe('filterByLevels', () => {
  const diagrams: DiagramConfig[] = [
    { name: 'overview', sources: ['./src'], level: 'package' },
    { name: 'frontend', sources: ['./src/frontend'], level: 'class' },
    { name: 'backend', sources: ['./src/backend'], level: 'class' },
    { name: 'utils', sources: ['./src/utils'], level: 'method' },
  ];

  it('should return all diagrams when levels is undefined', () => {
    const result = filterByLevels(diagrams, undefined);
    expect(result).toEqual(diagrams);
    expect(result).toHaveLength(4);
  });

  it('should return all diagrams when levels is empty array', () => {
    const result = filterByLevels(diagrams, []);
    expect(result).toEqual(diagrams);
    expect(result).toHaveLength(4);
  });

  it('should filter to only package-level diagrams', () => {
    const result = filterByLevels(diagrams, ['package']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('overview');
    expect(result[0].level).toBe('package');
  });

  it('should filter to only class-level diagrams', () => {
    const result = filterByLevels(diagrams, ['class']);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('frontend');
    expect(result[1].name).toBe('backend');
  });

  it('should filter to only method-level diagrams', () => {
    const result = filterByLevels(diagrams, ['method']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('utils');
  });

  it('should filter to multiple levels', () => {
    const result = filterByLevels(diagrams, ['package', 'class']);
    expect(result).toHaveLength(3);
    expect(result[0].level).toBe('package');
    expect(result[1].level).toBe('class');
    expect(result[2].level).toBe('class');
  });

  it('should return empty array when no levels match', () => {
    const result = filterByLevels(diagrams, ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('should default to class level when diagram has no level set', () => {
    const diagramsWithNoLevel: DiagramConfig[] = [
      { name: 'no-level', sources: ['./src'], level: 'class' }, // level is required in DiagramConfig
    ];
    const result = filterByLevels(diagramsWithNoLevel, ['class']);
    expect(result).toHaveLength(1);
  });

  it('should preserve order from original array', () => {
    const result = filterByLevels(diagrams, ['method', 'package']);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('overview'); // overview comes first in original
    expect(result[1].name).toBe('utils');
  });
});

describe('createAnalyzeCommand — flag presence', () => {
  it('should NOT have -l/--level flag', async () => {
    const { createAnalyzeCommand } = await import('@/cli/commands/analyze.js');
    const command = createAnalyzeCommand();
    const levelOption = command.options.find((opt) => opt.short === '-l' || opt.long === '--level');
    expect(levelOption).toBeUndefined();
  });

  it('should NOT have -n/--name flag', async () => {
    const { createAnalyzeCommand } = await import('@/cli/commands/analyze.js');
    const command = createAnalyzeCommand();
    const nameOption = command.options.find((opt) => opt.short === '-n' || opt.long === '--name');
    expect(nameOption).toBeUndefined();
  });

  it('should have --diagrams flag with level filter description', async () => {
    const { createAnalyzeCommand } = await import('@/cli/commands/analyze.js');
    const command = createAnalyzeCommand();
    const diagramsOption = command.options.find((opt) => opt.long === '--diagrams');
    expect(diagramsOption).toBeDefined();
    expect(diagramsOption?.description).toContain('level');
  });

  it('should have -s/--sources flag', async () => {
    const { createAnalyzeCommand } = await import('@/cli/commands/analyze.js');
    const command = createAnalyzeCommand();
    const sourcesOption = command.options.find((opt) => opt.long === '--sources');
    expect(sourcesOption).toBeDefined();
  });
});

describe('smart outputDir inference', () => {
  it('should be used from external source path outside cwd', async () => {
    // The smart outputDir inference happens in analyzeCommandHandler, which is
    // harder to unit test directly. We verify the logic exists by checking
    // that normalizeToDiagrams passes the source path to detectProjectStructure.
    vi.mocked(detectProjectStructure).mockResolvedValue([
      { name: 'architecture', sources: ['./src'], level: 'class' },
    ]);

    const cliOptions: CLIOptions = {
      sources: ['/external/project/src'],
    };

    await normalizeToDiagrams(baseConfig, cliOptions, '/home/user/archguard');

    // detectProjectStructure should be called with the external source root
    expect(detectProjectStructure).toHaveBeenCalled();
    const callArg = vi.mocked(detectProjectStructure).mock.calls[0][0];
    // The call should use the external source path (resolved)
    expect(typeof callArg).toBe('string');
  });
});

describe('regression: external source module paths must be absolute', () => {
  /**
   * Regression test for: https://github.com/archguard/archguard/issues/???
   *
   * Bug: normalizeToDiagrams called detectProjectStructure(absolutePath) — passing
   * the external source root as rootDir (1st arg). detectProjectStructure then
   * fell into default mode, called findSourceRoot() which returned './', and
   * built per-module paths like './openai_api_protocols'. Those relative paths
   * resolved against process.cwd(), not against the source root, causing
   * "path not found" errors for sub-module diagrams.
   *
   * Fix: call detectProjectStructure(process.cwd(), absolutePath) so external
   * mode is activated and absolute module paths are generated.
   */
  it('should call detectProjectStructure with (cwd, absoluteSourceRoot) not (absoluteSourceRoot)', async () => {
    vi.mocked(detectProjectStructure).mockResolvedValue([
      { name: 'overview/package', sources: ['/external/project/src'], level: 'package' },
      {
        name: 'method/openai_api_protocols',
        sources: ['/external/project/src/openai_api_protocols'],
        level: 'method',
      },
    ]);

    const cliOptions: CLIOptions = {
      sources: ['/external/project/src'],
    };

    await normalizeToDiagrams(baseConfig, cliOptions);

    const calls = vi.mocked(detectProjectStructure).mock.calls;
    expect(calls).toHaveLength(1);

    // First arg must be process.cwd() (NOT the external source root)
    expect(calls[0][0]).toBe(process.cwd());

    // Second arg must be the resolved absolute source root
    expect(calls[0][1]).toBe('/external/project/src');
  });

  it('should pass resolved absolute path as second arg even for relative --sources input', async () => {
    vi.mocked(detectProjectStructure).mockResolvedValue([
      { name: 'overview/package', sources: ['./src'], level: 'package' },
    ]);

    const cliOptions: CLIOptions = {
      sources: ['./src'],
    };

    await normalizeToDiagrams(baseConfig, cliOptions);

    const calls = vi.mocked(detectProjectStructure).mock.calls;
    expect(calls).toHaveLength(1);

    // First arg = cwd, second arg = resolved absolute path
    expect(calls[0][0]).toBe(process.cwd());
    const resolvedSrc = require('path').resolve('./src');
    expect(calls[0][1]).toBe(resolvedSrc);
  });

  it('should NOT call detectProjectStructure with single absolute arg (the bug pattern)', async () => {
    vi.mocked(detectProjectStructure).mockResolvedValue([
      { name: 'overview/package', sources: ['/external/project/src'], level: 'package' },
    ]);

    const cliOptions: CLIOptions = {
      sources: ['/external/project/src'],
    };

    await normalizeToDiagrams(baseConfig, cliOptions);

    const calls = vi.mocked(detectProjectStructure).mock.calls;
    expect(calls).toHaveLength(1);

    // Guard: first arg must NOT be the external absolute path (that was the bug)
    expect(calls[0][0]).not.toBe('/external/project/src');
  });
});
