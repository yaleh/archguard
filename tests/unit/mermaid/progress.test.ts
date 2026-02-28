/**
 * Unit tests for IProgressReporter and NoopProgressReporter
 * (src/mermaid/progress.ts)
 */

import { describe, it, expect } from 'vitest';
import { NoopProgressReporter } from '@/mermaid/progress';
import type { IProgressReporter } from '@/mermaid/progress';

describe('NoopProgressReporter', () => {
  it('should implement IProgressReporter interface', () => {
    const reporter: IProgressReporter = new NoopProgressReporter();
    expect(reporter).toBeDefined();
  });

  it('should have all required methods', () => {
    const reporter = new NoopProgressReporter();
    expect(typeof reporter.start).toBe('function');
    expect(typeof reporter.succeed).toBe('function');
    expect(typeof reporter.fail).toBe('function');
  });

  it('should have optional warn and info methods', () => {
    const reporter = new NoopProgressReporter();
    expect(typeof reporter.warn).toBe('function');
    expect(typeof reporter.info).toBe('function');
  });

  it('start() should not throw', () => {
    const reporter = new NoopProgressReporter();
    expect(() => reporter.start('Analyzing...')).not.toThrow();
  });

  it('succeed() should not throw', () => {
    const reporter = new NoopProgressReporter();
    expect(() => reporter.succeed('Done')).not.toThrow();
  });

  it('fail() should not throw', () => {
    const reporter = new NoopProgressReporter();
    expect(() => reporter.fail('Something went wrong')).not.toThrow();
  });

  it('warn() should not throw', () => {
    const reporter = new NoopProgressReporter();
    expect(() => reporter.warn!('Watch out')).not.toThrow();
  });

  it('info() should not throw', () => {
    const reporter = new NoopProgressReporter();
    expect(() => reporter.info!('FYI')).not.toThrow();
  });

  it('all methods should return undefined (fire-and-forget)', () => {
    const reporter = new NoopProgressReporter();
    expect(reporter.start('msg')).toBeUndefined();
    expect(reporter.succeed('msg')).toBeUndefined();
    expect(reporter.fail('msg')).toBeUndefined();
    expect(reporter.warn!('msg')).toBeUndefined();
    expect(reporter.info!('msg')).toBeUndefined();
  });

  it('should be callable in sequence without side-effects', () => {
    const reporter = new NoopProgressReporter();
    // Simulate the same lifecycle MermaidDiagramGenerator uses
    expect(() => {
      reporter.start('🧠 Analyzing architecture...');
      reporter.succeed('✅ Grouping complete');
      reporter.start('📝 Generating Mermaid code...');
      reporter.succeed('✅ Mermaid code generated');
      reporter.start('🔍 Validating...');
      reporter.succeed('✅ Validation passed');
    }).not.toThrow();
  });
});
