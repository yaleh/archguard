/**
 * Unit tests for MermaidDiagramGenerator progress injection
 * (src/mermaid/diagram-generator.ts)
 *
 * Verifies that:
 * - constructor accepts an optional IProgressReporter
 * - when no reporter is supplied, NoopProgressReporter is used (no throw)
 * - when a reporter is supplied, its methods are called during generation
 * - renderJobsInParallel accepts an optional progress parameter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator';
import { NoopProgressReporter } from '@/mermaid/progress';
import type { IProgressReporter } from '@/mermaid/progress';
import type { GlobalConfig } from '@/types/config';
import type { ArchJSON } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeConfig = (): GlobalConfig => ({
  outputDir: './archguard',
  format: 'mermaid',
  exclude: [],
  cli: { command: 'claude', args: [], timeout: 180000 },
  cache: { enabled: false, ttl: 3600 },
  concurrency: 1,
  verbose: false,
});

const makeArchJSON = (): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: ['src/foo.ts'],
  entities: [
    {
      id: 'Foo',
      name: 'Foo',
      type: 'class',
      visibility: 'public',
      members: [],
      decorators: [],
      sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 5 },
    },
  ],
  relations: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MermaidDiagramGenerator - progress injection', () => {
  let config: GlobalConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  describe('constructor', () => {
    it('should construct without a progress reporter (uses NoopProgressReporter internally)', () => {
      expect(() => new MermaidDiagramGenerator(config)).not.toThrow();
    });

    it('should construct with an explicit IProgressReporter', () => {
      const noop = new NoopProgressReporter();
      expect(() => new MermaidDiagramGenerator(config, noop)).not.toThrow();
    });

    it('should construct with a custom spy reporter', () => {
      const reporter: IProgressReporter = {
        start: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      };
      expect(() => new MermaidDiagramGenerator(config, reporter)).not.toThrow();
    });
  });

  describe('generateOnly - progress calls', () => {
    it('should call progress.start and progress.succeed during generation', async () => {
      const reporter: IProgressReporter = {
        start: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      };

      // Mock heavy dependencies so the test is fast and isolated
      vi.mock('@/mermaid/validation-pipeline.js', () => ({
        MermaidValidationPipeline: vi.fn().mockImplementation(() => ({
          validateFull: vi.fn().mockResolvedValue({ overallValid: true }),
          generateReport: vi.fn().mockReturnValue(''),
        })),
      }));

      const generator = new MermaidDiagramGenerator(config, reporter);
      const archJSON = makeArchJSON();

      // generateOnly may throw for unrelated reasons (renderer / fs) in unit test;
      // we only care that progress methods were invoked, not that render succeeds.
      try {
        await generator.generateOnly(archJSON, { mmdPath: '/tmp/test.mmd' }, 'class');
      } catch {
        // acceptable – renderer or fs may not be available in unit test
      }

      expect(reporter.start).toHaveBeenCalled();
      // succeed or fail will be called depending on validation outcome
      const succeedOrFail =
        (reporter.succeed as ReturnType<typeof vi.fn>).mock.calls.length +
        (reporter.fail as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(succeedOrFail).toBeGreaterThan(0);
    });

    it('should return empty array without calling progress when archJSON has no entities', async () => {
      const reporter: IProgressReporter = {
        start: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      };
      const generator = new MermaidDiagramGenerator(config, reporter);
      const emptyArchJSON: ArchJSON = { ...makeArchJSON(), entities: [] };

      const jobs = await generator.generateOnly(emptyArchJSON, { mmdPath: '/tmp/test.mmd' }, 'class');

      expect(jobs).toEqual([]);
      expect(reporter.start).not.toHaveBeenCalled();
    });
  });

  describe('renderJobsInParallel - progress parameter', () => {
    it('should accept no progress parameter (defaults to NoopProgressReporter)', async () => {
      // Empty jobs array — completes immediately without rendering
      await expect(MermaidDiagramGenerator.renderJobsInParallel([], 1)).resolves.toBeUndefined();
    });

    it('should accept an explicit progress reporter', async () => {
      const reporter: IProgressReporter = {
        start: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      };
      await expect(
        MermaidDiagramGenerator.renderJobsInParallel([], 1, reporter)
      ).resolves.toBeUndefined();
    });

    it('should call progress.start and progress.succeed for empty job list', async () => {
      const reporter: IProgressReporter = {
        start: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      };
      await MermaidDiagramGenerator.renderJobsInParallel([], 1, reporter);

      expect(reporter.start).toHaveBeenCalledOnce();
      expect(reporter.succeed).toHaveBeenCalledOnce();
    });
  });
});
