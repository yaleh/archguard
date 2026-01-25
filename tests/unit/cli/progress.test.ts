/**
 * Story 2: Progress Display Tests
 * TDD: Red phase - These tests should fail initially
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressReporter } from '@/cli/progress';

describe('Story 2: Progress Display', () => {
  let reporter: ProgressReporter;

  beforeEach(() => {
    reporter = new ProgressReporter();
  });

  describe('Basic Spinner Functions', () => {
    it('should create a progress reporter instance', () => {
      expect(reporter).toBeDefined();
    });

    it('should start spinner with message', () => {
      reporter.start('Parsing files...');
      const stages = reporter.getStages();

      expect(stages).toHaveLength(1);
      expect(stages[0]?.name).toBe('Parsing files...');
      expect(stages[0]?.status).toBe('running');
    });

    it('should update progress with count and percentage', () => {
      reporter.start('Parsing files...');
      reporter.update(10, 50);

      const stages = reporter.getStages();
      expect(stages[0]?.status).toBe('running');
      // Verify progress is being tracked (implementation will show in text)
    });

    it('should succeed with message', () => {
      reporter.start('Parsing files...');
      reporter.succeed('Parsed 50 files');

      const stages = reporter.getStages();
      expect(stages[0]?.status).toBe('success');
      expect(stages[0]?.endTime).toBeDefined();
    });

    it('should fail with error message', () => {
      reporter.start('Parsing files...');
      reporter.fail('Failed to parse: syntax error');

      const stages = reporter.getStages();
      expect(stages[0]?.status).toBe('failed');
      expect(stages[0]?.endTime).toBeDefined();
    });

    it('should warn with warning message', () => {
      reporter.start('Parsing files...');
      reporter.warn('Some files skipped');

      const stages = reporter.getStages();
      expect(stages[0]?.status).toBe('warning');
      expect(stages[0]?.endTime).toBeDefined();
    });
  });

  describe('Multi-stage Progress', () => {
    it('should support multi-stage progress', () => {
      reporter.start('Stage 1: Parsing');
      reporter.succeed('Parsed 50 files');

      reporter.start('Stage 2: Analyzing');
      reporter.succeed('Analyzed 50 files');

      reporter.start('Stage 3: Generating');
      reporter.succeed('Generated PlantUML diagram');

      const stages = reporter.getStages();
      expect(stages).toHaveLength(3);
      expect(stages.every((s) => s.status === 'success')).toBe(true);
    });

    it('should track stage timing', async () => {
      reporter.start('Stage 1');
      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      reporter.succeed('Done');

      const stages = reporter.getStages();
      expect(stages[0]?.startTime).toBeDefined();
      expect(stages[0]?.endTime).toBeDefined();
      expect(stages[0]?.endTime).toBeGreaterThan(stages[0]?.startTime || 0);
    });

    it('should handle failed stage in multi-stage workflow', () => {
      reporter.start('Stage 1: Parsing');
      reporter.succeed('Parsed 50 files');

      reporter.start('Stage 2: Analyzing');
      reporter.fail('Analysis failed');

      const stages = reporter.getStages();
      expect(stages).toHaveLength(2);
      expect(stages[0]?.status).toBe('success');
      expect(stages[1]?.status).toBe('failed');
    });
  });

  describe('Summary Reporting', () => {
    it('should calculate total duration', async () => {
      reporter.start('Stage 1');
      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      reporter.succeed('Done');

      const summary = reporter.getSummary();
      expect(summary.totalDuration).toBeGreaterThan(0);
    });

    it('should count successful stages', () => {
      reporter.start('Stage 1');
      reporter.succeed('Done');

      reporter.start('Stage 2');
      reporter.succeed('Done');

      const summary = reporter.getSummary();
      expect(summary.successCount).toBe(2);
      expect(summary.failureCount).toBe(0);
    });

    it('should count failed stages', () => {
      reporter.start('Stage 1');
      reporter.succeed('Done');

      reporter.start('Stage 2');
      reporter.fail('Error');

      const summary = reporter.getSummary();
      expect(summary.successCount).toBe(1);
      expect(summary.failureCount).toBe(1);
    });

    it('should format duration in seconds', () => {
      reporter.start('Stage 1');
      reporter.succeed('Done');

      const summary = reporter.getSummary();
      expect(summary.totalDurationFormatted).toMatch(/\d+\.\d{2}s/);
    });
  });

  describe('Progress Updates', () => {
    it('should calculate percentage correctly', () => {
      reporter.start('Processing');
      reporter.update(25, 100);

      const currentStage = reporter.getCurrentStage();
      expect(currentStage?.progress).toBeDefined();
      expect(currentStage?.progress?.completed).toBe(25);
      expect(currentStage?.progress?.total).toBe(100);
      expect(currentStage?.progress?.percentage).toBe(25);
    });

    it('should handle 0 total gracefully', () => {
      reporter.start('Processing');
      reporter.update(0, 0);

      const currentStage = reporter.getCurrentStage();
      expect(currentStage?.progress?.percentage).toBe(0);
    });

    it('should update progress multiple times', () => {
      reporter.start('Processing');
      reporter.update(10, 100);
      reporter.update(50, 100);
      reporter.update(100, 100);

      const currentStage = reporter.getCurrentStage();
      expect(currentStage?.progress?.completed).toBe(100);
      expect(currentStage?.progress?.percentage).toBe(100);
    });
  });

  describe('Info Messages', () => {
    it('should display info message without starting stage', () => {
      reporter.info('Processing file: test.ts');
      // Should not create a new stage
      const stages = reporter.getStages();
      expect(stages).toHaveLength(0);
    });
  });
});
