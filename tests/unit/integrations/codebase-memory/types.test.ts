import { describe, it, expect } from 'vitest';
import {
  createDiagnostic,
  createBackendResult,
  hasErrorDiagnostic,
  type BackendResult,
  type BackendDiagnostic,
} from '@/integrations/codebase-memory/types.js';

describe('codebase-memory types — createDiagnostic', () => {
  it('defaults severity to error and omits empty nextSteps', () => {
    const d = createDiagnostic('binary-missing', 'binary not found');
    expect(d).toEqual({
      code: 'binary-missing',
      severity: 'error',
      message: 'binary not found',
    });
    expect(d).not.toHaveProperty('nextSteps');
  });

  it('honors explicit severity and nextSteps', () => {
    const d = createDiagnostic('project-not-indexed', 'not indexed', {
      severity: 'warning',
      nextSteps: ['codebase-memory-mcp cli index_repository \'{"repo_path":"/r"}\''],
    });
    expect(d.severity).toBe('warning');
    expect(d.nextSteps).toHaveLength(1);
  });

  it('drops an empty nextSteps array', () => {
    const d = createDiagnostic('timeout', 'timed out', { nextSteps: [] });
    expect(d).not.toHaveProperty('nextSteps');
  });
});

describe('codebase-memory types — createBackendResult envelope', () => {
  it('produces a minimal envelope with only required fields', () => {
    const r = createBackendResult('archguard', '/repo', { results: [] });
    expect(r).toEqual({
      backend: 'archguard',
      projectRoot: '/repo',
      data: { results: [] },
    });
    expect(r).not.toHaveProperty('codebaseMemoryProject');
    expect(r).not.toHaveProperty('stale');
    expect(r).not.toHaveProperty('diagnostics');
  });

  it('includes optional metadata when provided', () => {
    const diags: BackendDiagnostic[] = [createDiagnostic('timeout', 'x')];
    const r: BackendResult<{ n: number }> = createBackendResult(
      'codebase-memory',
      '/repo',
      { n: 1 },
      { codebaseMemoryProject: 'repo', stale: true, diagnostics: diags }
    );
    expect(r.codebaseMemoryProject).toBe('repo');
    expect(r.stale).toBe(true);
    expect(r.diagnostics).toBe(diags);
  });

  it('omits an empty diagnostics array', () => {
    const r = createBackendResult('combined', '/repo', null, { diagnostics: [] });
    expect(r).not.toHaveProperty('diagnostics');
  });

  it('preserves stale=false explicitly', () => {
    const r = createBackendResult('codebase-memory', '/repo', null, { stale: false });
    expect(r.stale).toBe(false);
  });
});

describe('codebase-memory types — hasErrorDiagnostic', () => {
  it('returns false for undefined or empty', () => {
    expect(hasErrorDiagnostic()).toBe(false);
    expect(hasErrorDiagnostic([])).toBe(false);
  });

  it('returns false when only warnings/info present', () => {
    expect(
      hasErrorDiagnostic([
        createDiagnostic('project-not-indexed', 'a', { severity: 'warning' }),
        createDiagnostic('unsupported', 'b', { severity: 'info' }),
      ])
    ).toBe(false);
  });

  it('returns true when any error diagnostic is present', () => {
    expect(
      hasErrorDiagnostic([
        createDiagnostic('project-not-indexed', 'a', { severity: 'warning' }),
        createDiagnostic('binary-missing', 'b'),
      ])
    ).toBe(true);
  });
});
