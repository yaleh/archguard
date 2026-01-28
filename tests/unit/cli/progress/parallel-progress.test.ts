/**
 * Unit tests for ParallelProgressReporter
 *
 * TDD test suite for parallel progress bars using cli-progress
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';

// Mock cli-progress to avoid actual terminal output in tests
vi.mock('cli-progress', () => ({
  MultiBar: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockReturnValue({
      update: vi.fn(),
    }),
    stop: vi.fn(),
  })),
  Presets: {
    shades_classic: {},
  },
}));

// Mock chalk to avoid color codes in tests
vi.mock('chalk', async () => {
  const actual = await vi.importActual('chalk');
  return {
    ...actual,
    cyan: (text: string) => text,
    green: (text: string) => text,
    red: (text: string) => text,
  };
});

describe('ParallelProgressReporter', () => {
  let reporter: ParallelProgressReporter;

  afterEach(() => {
    reporter?.stop();
  });

  describe('constructor', () => {
    it('should create progress bars for all diagrams', () => {
      const diagrams = ['diagram1', 'diagram2', 'diagram3'];
      reporter = new ParallelProgressReporter(diagrams);

      expect(reporter).toBeDefined();
    });

    it('should handle empty diagram array', () => {
      const diagrams: string[] = [];
      reporter = new ParallelProgressReporter(diagrams);

      expect(reporter).toBeDefined();
    });

    it('should handle single diagram', () => {
      const diagrams = ['single-diagram'];
      reporter = new ParallelProgressReporter(diagrams);

      expect(reporter).toBeDefined();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      reporter = new ParallelProgressReporter(['diagram1', 'diagram2']);
    });

    it('should update progress for valid diagram', () => {
      expect(() => {
        reporter.update('diagram1', 50, 'Processing');
      }).not.toThrow();
    });

    it('should update progress with custom status', () => {
      expect(() => {
        reporter.update('diagram1', 25, 'Parsing');
        reporter.update('diagram1', 50, 'Generating');
        reporter.update('diagram1', 75, 'Rendering');
      }).not.toThrow();
    });

    it('should handle progress out of range', () => {
      expect(() => {
        reporter.update('diagram1', -10, 'Invalid negative');
        reporter.update('diagram1', 150, 'Invalid over 100');
      }).not.toThrow();
    });

    it('should handle non-existent diagram name gracefully', () => {
      expect(() => {
        reporter.update('non-existent', 50, 'Should not throw');
      }).not.toThrow();
    });
  });

  describe('complete', () => {
    beforeEach(() => {
      reporter = new ParallelProgressReporter(['diagram1', 'diagram2']);
    });

    it('should mark diagram as completed', () => {
      expect(() => {
        reporter.complete('diagram1');
      }).not.toThrow();
    });

    it('should complete multiple diagrams', () => {
      expect(() => {
        reporter.complete('diagram1');
        reporter.complete('diagram2');
      }).not.toThrow();
    });

    it('should handle non-existent diagram gracefully', () => {
      expect(() => {
        reporter.complete('non-existent');
      }).not.toThrow();
    });
  });

  describe('fail', () => {
    beforeEach(() => {
      reporter = new ParallelProgressReporter(['diagram1', 'diagram2']);
    });

    it('should mark diagram as failed', () => {
      expect(() => {
        reporter.fail('diagram1');
      }).not.toThrow();
    });

    it('should fail multiple diagrams', () => {
      expect(() => {
        reporter.fail('diagram1');
        reporter.fail('diagram2');
      }).not.toThrow();
    });

    it('should handle non-existent diagram gracefully', () => {
      expect(() => {
        reporter.fail('non-existent');
      }).not.toThrow();
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      reporter = new ParallelProgressReporter(['diagram1', 'diagram2']);
    });

    it('should stop all progress bars', () => {
      expect(() => {
        reporter.stop();
      }).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        reporter.stop();
        reporter.stop();
        reporter.stop();
      }).not.toThrow();
    });
  });

  describe('integration workflow', () => {
    it('should handle complete workflow for multiple diagrams', () => {
      const diagrams = ['01-parser', '02-validator', '03-generator'];
      reporter = new ParallelProgressReporter(diagrams);

      // Simulate processing
      reporter.update('01-parser', 25, 'Parsing');
      reporter.update('01-parser', 50, 'Generating');
      reporter.update('01-parser', 100, 'Complete');
      reporter.complete('01-parser');

      reporter.update('02-validator', 33, 'Validating');
      reporter.update('02-validator', 66, 'Checking');
      reporter.update('02-validator', 100, 'Complete');
      reporter.complete('02-validator');

      reporter.update('03-generator', 10, 'Starting');
      reporter.update('03-generator', 50, 'Processing');
      reporter.fail('03-generator');

      expect(() => {
        reporter.stop();
      }).not.toThrow();
    });

    it('should handle mixed success and failure scenarios', () => {
      const diagrams = ['diagram1', 'diagram2', 'diagram3', 'diagram4'];
      reporter = new ParallelProgressReporter(diagrams);

      // Diagram 1: Success
      reporter.update('diagram1', 100);
      reporter.complete('diagram1');

      // Diagram 2: Failure
      reporter.update('diagram2', 50);
      reporter.fail('diagram2');

      // Diagram 3: Success with updates
      reporter.update('diagram3', 25, 'Step 1');
      reporter.update('diagram3', 50, 'Step 2');
      reporter.update('diagram3', 75, 'Step 3');
      reporter.complete('diagram3');

      // Diagram 4: Partial progress
      reporter.update('diagram4', 30, 'Started');

      reporter.stop();
    });
  });
});
