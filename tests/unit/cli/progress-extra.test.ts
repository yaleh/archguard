/**
 * Unit tests for ProgressReporter.printSummary/stop and the Stderr/Noop reporters.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProgressReporter, StderrReporter, NoopReporter } from '@/cli/progress/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProgressReporter.printSummary', () => {
  it('prints a summary with durations and counts', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = new ProgressReporter();
    reporter.start('stage one');
    reporter.succeed('done one');
    reporter.start('stage two');
    reporter.fail('failed two');
    reporter.start('stage three');
    reporter.warn('warned three');
    reporter.printSummary();
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Summary:'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Total:'))).toBe(true);
  });

  it('handles running stages with N/A duration', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = new ProgressReporter();
    reporter.start('still running');
    reporter.printSummary();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('N/A'))).toBe(true);
  });
});

describe('ProgressReporter.stop', () => {
  it('stops the underlying spinner without throwing', () => {
    const reporter = new ProgressReporter();
    reporter.start('work');
    expect(() => reporter.stop()).not.toThrow();
  });
});

describe('ProgressReporter.getSummary counts', () => {
  it('tallies success/failure/warning counts and total duration', () => {
    const reporter = new ProgressReporter();
    reporter.start('a');
    reporter.succeed('a done');
    reporter.start('b');
    reporter.fail('b done');
    reporter.start('c');
    reporter.warn('c done');
    const summary = reporter.getSummary();
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.totalDurationFormatted).toMatch(/s$/);
  });
});

describe('StderrReporter', () => {
  it('writes every method to stderr via console.error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = new StderrReporter();
    r.start('s');
    r.succeed('ok');
    r.fail('no');
    r.warn('w');
    r.info('i');
    expect(errSpy).toHaveBeenCalledTimes(5);
  });
});

describe('NoopReporter', () => {
  it('performs no output for any method', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = new NoopReporter();
    r.start('s');
    r.succeed('ok');
    r.fail('no');
    r.warn('w');
    r.info('i');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
