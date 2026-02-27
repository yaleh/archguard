/**
 * Unit tests for analyze command
 * Tests normalizeToDiagrams and filterDiagrams functions
 */

import { describe, it, expect } from 'vitest';
import { normalizeToDiagrams, filterDiagrams } from '@/cli/commands/analyze.js';
import type { Config } from '@/cli/config-loader.js';
import type { CLIOptions, DiagramConfig } from '@/types/config.js';

describe('normalizeToDiagrams', () => {
  describe('Priority 1: Config file diagrams', () => {
    it('should use config.diagrams when present', () => {
      const config: Config = {
        diagrams: [
          { name: 'frontend', sources: ['./src/frontend'], level: 'class' },
          { name: 'backend', sources: ['./src/backend'], level: 'class' },
        ],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./cli-src'],
        name: 'cli-diagram',
        level: 'method',
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toEqual(config.diagrams);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('frontend');
      expect(result[1].name).toBe('backend');
    });

    it('should ignore CLI options when config.diagrams exists', () => {
      const config: Config = {
        diagrams: [{ name: 'configured', sources: ['./configured'], level: 'package' }],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./cli-src'],
        name: 'cli-name',
        level: 'method',
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('configured');
      expect(result[0].sources).toEqual(['./configured']);
      expect(result[0].level).toBe('package');
    });
  });

  describe('Priority 2: CLI shortcut', () => {
    it('should create diagram from CLI sources when config.diagrams is empty', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: ['**/*.test.ts'],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./src/cli', './src/parser'],
        name: 'custom',
        level: 'method',
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'custom',
        sources: ['./src/cli', './src/parser'],
        level: 'method',
        format: undefined,
        exclude: undefined,
      });
    });

    it('should use default name when CLI name not provided', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./src'],
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('architecture');
      expect(result[0].sources).toEqual(['./src']);
      expect(result[0].level).toBe('class'); // default level
    });

    it('should use default level when CLI level not provided', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./src'],
        name: 'test',
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result[0].level).toBe('class');
    });

    it('should include format and exclude when provided in CLI', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {
        sources: ['./src'],
        format: 'json',
        exclude: ['**/*.spec.ts'],
      };

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result[0].format).toBe('json');
      expect(result[0].exclude).toEqual(['**/*.spec.ts']);
    });
  });

  describe('Priority 3: Default config', () => {
    it('should return default diagram when no config.diagrams and no CLI sources', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {};

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'architecture',
        sources: ['./src'],
        level: 'class',
      });
    });

    it('should handle empty CLI options', () => {
      const config: Config = {
        diagrams: [],
        outputDir: './archguard',
        format: 'plantuml',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 60000 },
        cache: { enabled: true, ttl: 86400 },
        concurrency: 8,
        verbose: false,
      };

      const cliOptions: CLIOptions = {};

      const result = normalizeToDiagrams(config, cliOptions);

      expect(result).toEqual([
        {
          name: 'architecture',
          sources: ['./src'],
          level: 'class',
        },
      ]);
    });
  });
});

describe('Go Atlas default mode', () => {
    const baseConfig: Config = {
      diagrams: [],
      outputDir: './archguard',
      format: 'mermaid',
      exclude: [],
      cli: { command: 'claude', args: [], timeout: 60000 },
      cache: { enabled: true, ttl: 86400 },
      concurrency: 8,
      verbose: false,
    };

    it('--lang go enables atlas by default without --atlas flag', () => {
      const result = normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific?.['atlas']).toMatchObject({ enabled: true });
    });

    it('--lang go --no-atlas disables atlas (opt-out)', () => {
      const result = normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
        noAtlas: true,
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific).toBeUndefined();
    });

    it('--atlas still works as before (implies --lang go + atlas)', () => {
      const result = normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        atlas: true,
      });

      expect(result[0].language).toBe('go');
      expect(result[0].languageSpecific?.['atlas']).toMatchObject({ enabled: true });
    });

    it('--lang go uses selective strategy by default', () => {
      const result = normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
      });

      const atlasConfig = result[0].languageSpecific?.['atlas'] as any;
      expect(atlasConfig.functionBodyStrategy).toBe('selective');
    });

    it('--lang go --atlas-strategy full passes strategy through', () => {
      const result = normalizeToDiagrams(baseConfig, {
        sources: ['./src'],
        lang: 'go',
        atlasStrategy: 'full',
      });

      const atlasConfig = result[0].languageSpecific?.['atlas'] as any;
      expect(atlasConfig.functionBodyStrategy).toBe('full');
    });
  });

describe('filterDiagrams', () => {
  const diagrams: DiagramConfig[] = [
    { name: 'overview', sources: ['./src'], level: 'package' },
    { name: 'frontend', sources: ['./src/frontend'], level: 'class' },
    { name: 'backend', sources: ['./src/backend'], level: 'class' },
    { name: 'utils', sources: ['./src/utils'], level: 'method' },
  ];

  it('should return all diagrams when selectedNames is undefined', () => {
    const result = filterDiagrams(diagrams, undefined);
    expect(result).toEqual(diagrams);
    expect(result).toHaveLength(4);
  });

  it('should return all diagrams when selectedNames is empty array', () => {
    const result = filterDiagrams(diagrams, []);
    expect(result).toEqual(diagrams);
    expect(result).toHaveLength(4);
  });

  it('should filter single diagram by name', () => {
    const result = filterDiagrams(diagrams, ['frontend']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('frontend');
  });

  it('should filter multiple diagrams by names', () => {
    const result = filterDiagrams(diagrams, ['frontend', 'backend']);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('frontend');
    expect(result[1].name).toBe('backend');
  });

  it('should return empty array when no matches', () => {
    const result = filterDiagrams(diagrams, ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('should handle partial matches correctly', () => {
    const result = filterDiagrams(diagrams, ['frontend', 'nonexistent']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('frontend');
  });

  it('should preserve order from original array', () => {
    const result = filterDiagrams(diagrams, ['utils', 'overview']);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('overview'); // overview comes first in original
    expect(result[1].name).toBe('utils');
  });
});
