import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CodebaseMemoryClient,
  type ProcessRunner,
  type ProcessRunResult,
} from '@/integrations/codebase-memory/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../fixtures/codebase-memory');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

function runnerReturning(partial: Partial<ProcessRunResult>): ProcessRunner {
  const result: ProcessRunResult = {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    spawnFailed: false,
    ...partial,
  };
  return vi.fn(async () => result);
}

describe('CodebaseMemoryClient — successful parse', () => {
  it('parses JSON stdout from a contract fixture', async () => {
    const stdout = loadFixture('list_projects.json');
    const runner = runnerReturning({ stdout });
    const client = new CodebaseMemoryClient({ runner });

    const res = await client.call<{ projects: unknown[] }>('list_projects');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.projects).toHaveLength(3);
    }
  });

  it('passes cli <tool> <json> args to the runner', async () => {
    const runner = runnerReturning({ stdout: loadFixture('search_graph.class.json') });
    const client = new CodebaseMemoryClient({ runner, command: 'cbm', timeoutMs: 1234 });

    const res = await client.call('search_graph', { name_pattern: '.*Handler.*', limit: 20 });

    expect(res.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      'cbm',
      ['cli', 'search_graph', JSON.stringify({ name_pattern: '.*Handler.*', limit: 20 })],
      { timeoutMs: 1234 }
    );
  });

  it('omits the json argument when no args are supplied', async () => {
    const runner = runnerReturning({ stdout: '{}' });
    const client = new CodebaseMemoryClient({ runner });
    await client.call('list_projects');
    expect(runner).toHaveBeenCalledWith(
      'codebase-memory-mcp',
      ['cli', 'list_projects'],
      expect.objectContaining({ timeoutMs: 10000 })
    );
  });
});

describe('CodebaseMemoryClient — binary missing', () => {
  it('normalizes spawn failure to a binary-missing diagnostic with next steps', async () => {
    const runner = runnerReturning({ spawnFailed: true, exitCode: null });
    const client = new CodebaseMemoryClient({ runner, command: 'codebase-memory-mcp' });

    const res = await client.call('list_projects');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('binary-missing');
      expect(res.diagnostic.severity).toBe('error');
      expect(res.diagnostic.message).toContain('codebase-memory-mcp');
      expect(res.diagnostic.nextSteps?.length).toBeGreaterThan(0);
      // Must not leak ENOENT/subprocess detail.
      expect(res.diagnostic.message).not.toContain('ENOENT');
    }
  });
});

describe('CodebaseMemoryClient — timeout', () => {
  it('normalizes a timed-out run to a timeout diagnostic', async () => {
    const runner = runnerReturning({ timedOut: true, exitCode: null, signal: 'SIGTERM' });
    const client = new CodebaseMemoryClient({ runner, timeoutMs: 2500 });

    const res = await client.call('search_graph', { name_pattern: 'x' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('timeout');
      expect(res.diagnostic.message).toContain('2500ms');
    }
  });
});

describe('CodebaseMemoryClient — parse failure', () => {
  it('normalizes invalid JSON to a parse-error diagnostic without crashing', async () => {
    const runner = runnerReturning({ stdout: 'not json <<<', stderr: '' });
    const client = new CodebaseMemoryClient({ runner });

    const res = await client.call('search_graph');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('parse-error');
      expect(res.diagnostic.message).toContain('not json');
    }
  });
});

describe('CodebaseMemoryClient — backend error (non-zero exit)', () => {
  it('normalizes a non-zero exit code to a backend-error diagnostic', async () => {
    const runner = runnerReturning({ exitCode: 2, stderr: 'project not found' });
    const client = new CodebaseMemoryClient({ runner });

    const res = await client.call('search_graph');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('backend-error');
      expect(res.diagnostic.message).toContain('project not found');
    }
  });

  it('normalizes a throwing runner to a backend-error diagnostic (defensive)', async () => {
    const runner: ProcessRunner = vi.fn(async () => {
      throw new Error('unexpected');
    });
    const client = new CodebaseMemoryClient({ runner });

    const res = await client.call('list_projects');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('backend-error');
    }
  });
});
