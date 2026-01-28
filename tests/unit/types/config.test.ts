/**
 * Configuration Type Tests for v2.0 API
 * Testing the new diagrams[] array structure and level parameter
 */

import { describe, it, expect } from 'vitest';
import type { ArchGuardConfig, DiagramConfig, CLIOptions } from '@/types/config';
import { ConfigLoader } from '@/cli/config-loader';

describe('Config Types - v2.0 API', () => {
  describe('DiagramConfig structure', () => {
    it('should accept diagram with name and sources', () => {
      const diagram: DiagramConfig = {
        name: 'overview',
        sources: ['./src/**'],
        level: 'package',
      };
      expect(diagram.name).toBe('overview');
      expect(diagram.sources).toEqual(['./src/**']);
      expect(diagram.level).toBe('package');
    });

    it('should support multiple sources in a diagram', () => {
      const diagram: DiagramConfig = {
        name: 'modules/auth',
        sources: ['./src/auth', './src/identity', './src/security'],
        level: 'class',
      };
      expect(diagram.sources).toHaveLength(3);
    });

    it('should support optional description and format', () => {
      const diagram: DiagramConfig = {
        name: 'parser',
        sources: ['./src/parser'],
        level: 'method',
        description: 'Parser module detailed view',
        format: 'json',
      };
      expect(diagram.description).toBe('Parser module detailed view');
      expect(diagram.format).toBe('json');
    });
  });

  describe('ArchGuardConfig with diagrams array', () => {
    it('should accept config with empty diagrams array', () => {
      const config: ArchGuardConfig = {
        diagrams: [],
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
        concurrency: 8,
        verbose: false,
      };
      expect(config.diagrams).toEqual([]);
    });

    it('should accept config with single diagram', () => {
      const config: ArchGuardConfig = {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
        concurrency: 8,
        verbose: false,
      };
      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('overview');
    });

    it('should accept config with multiple diagrams', () => {
      const config: ArchGuardConfig = {
        diagrams: [
          {
            name: 'overview',
            sources: ['./src/**'],
            level: 'package',
          },
          {
            name: 'modules/parser',
            sources: ['./src/parser'],
            level: 'class',
          },
          {
            name: 'modules/cli',
            sources: ['./src/cli'],
            level: 'method',
          },
        ],
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: {
          command: 'claude',
          args: [],
          timeout: 60000,
        },
        cache: {
          enabled: true,
          ttl: 86400,
        },
        concurrency: 8,
        verbose: false,
      };
      expect(config.diagrams).toHaveLength(3);
      expect(config.diagrams[0].level).toBe('package');
      expect(config.diagrams[1].level).toBe('class');
      expect(config.diagrams[2].level).toBe('method');
    });
  });

  describe('CLIOptions with new parameters', () => {
    it('should include sources (plural)', () => {
      const options: CLIOptions = {
        sources: ['./src', './lib'],
        format: 'mermaid',
      };
      expect(options.sources).toEqual(['./src', './lib']);
    });

    it('should include level parameter', () => {
      const options: CLIOptions = {
        sources: ['./src'],
        level: 'package',
      };
      expect(options.level).toBe('package');
    });

    it('should include diagrams filter', () => {
      const options: CLIOptions = {
        diagrams: ['overview', 'modules/parser'],
      };
      expect(options.diagrams).toEqual(['overview', 'modules/parser']);
    });

    it('should include name option', () => {
      const options: CLIOptions = {
        sources: ['./src'],
        name: 'my-architecture',
      };
      expect(options.name).toBe('my-architecture');
    });
  });
});

describe('ConfigLoader Schema Validation - v2.0 API', () => {
  const configLoader = new ConfigLoader('/tmp/test-config');

  describe('Diagrams array validation', () => {
    it('should validate empty diagrams array', async () => {
      const config = await configLoader.load({});
      expect(config.diagrams).toBeDefined();
      expect(Array.isArray(config.diagrams)).toBe(true);
    });

    it('should validate single diagram', async () => {
      const config = await configLoader.load({
        diagrams: [
          {
            name: 'overview',
            sources: ['./src'],
            level: 'class',
          },
        ],
      });
      expect(config.diagrams).toHaveLength(1);
      expect(config.diagrams[0].name).toBe('overview');
      expect(config.diagrams[0].sources).toEqual(['./src']);
      expect(config.diagrams[0].level).toBe('class');
    });

    it('should validate multiple diagrams', async () => {
      const config = await configLoader.load({
        diagrams: [
          { name: 'overview', sources: ['./src/**'], level: 'package' },
          { name: 'modules/parser', sources: ['./src/parser'], level: 'class' },
        ],
      });
      expect(config.diagrams).toHaveLength(2);
    });
  });

  describe('Level validation', () => {
    it('should accept valid level values', async () => {
      const levels: Array<'package' | 'class' | 'method'> = ['package', 'class', 'method'];

      for (const level of levels) {
        const config = await configLoader.load({
          diagrams: [{ name: 'test', sources: ['./src'], level }],
        });
        expect(config.diagrams[0].level).toBe(level);
      }
    });

    it('should reject invalid level value', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({
          diagrams: [{ name: 'test', sources: ['./src'], level: 'invalid' as any }],
        })
      ).rejects.toThrow();
    });
  });

  describe('Invalid input rejection', () => {
    it('should reject diagram without required name', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ diagrams: [{ sources: ['./src'], level: 'class' } as any] })
      ).rejects.toThrow();
    });

    it('should reject diagram without required sources', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ diagrams: [{ name: 'test', level: 'class' } as any] })
      ).rejects.toThrow();
    });

    it('should reject diagram without required level', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configLoader.load({ diagrams: [{ name: 'test', sources: ['./src'] } as any] })
      ).rejects.toThrow();
    });
  });
});
