/**
 * Unit tests for `archguard config doctor codebase-memory`.
 *
 * The doctor is a strictly read-only probe: it checks that the backend binary
 * is locatable, that `list_projects` is executable, that the current
 * `projectRoot` resolves to a unique Codebase Memory project, and whether that
 * project is indexed — emitting a structured {ok, binary, project, nextSteps}
 * report. It must NEVER mutate the environment (no install, no index, no
 * config writes).
 *
 * All tests inject a mock {@link CodebaseMemoryClient}; nothing depends on an
 * external binary being installed.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md (doctor契约).
 */

import { describe, it, expect, vi } from 'vitest';
import { runCodebaseMemoryDoctor } from '@/cli/commands/doctor.js';
import type {
  CodebaseMemoryClient,
  ClientCallResult,
} from '@/integrations/codebase-memory/client.js';
import { createDiagnostic } from '@/integrations/codebase-memory/types.js';

/**
 * Build a mock client whose `call` returns queued results per tool name.
 * Tracks every invocation so tests can assert the read-only contract.
 */
function mockClient(handlers: { list_projects?: ClientCallResult<unknown>; command?: string }): {
  client: CodebaseMemoryClient;
  calls: Array<{ tool: string; args?: unknown }>;
} {
  const calls: Array<{ tool: string; args?: unknown }> = [];
  const client = {
    getCommand: () => handlers.command ?? 'codebase-memory-mcp',
    call: vi.fn(async (tool: string, args?: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === 'list_projects') {
        return (
          handlers.list_projects ?? {
            ok: true,
            data: { projects: [] },
            stderr: '',
          }
        );
      }
      // Any unexpected tool would be a write/probe we did not authorize.
      return {
        ok: false,
        diagnostic: createDiagnostic('unsupported', `unexpected tool ${tool}`),
      };
    }),
  } as unknown as CodebaseMemoryClient;
  return { client, calls };
}

const okList = (projects: unknown[]): ClientCallResult<unknown> => ({
  ok: true,
  data: { projects },
  stderr: '',
});

describe('runCodebaseMemoryDoctor — structured report shape', () => {
  it('returns {ok, backend, binary, project, nextSteps}', async () => {
    const { client } = mockClient({
      list_projects: okList([{ name: 'repo', root: '/repo', indexed: true }]),
    });
    const report = await runCodebaseMemoryDoctor(client, '/repo');

    expect(report).toHaveProperty('ok');
    expect(report).toHaveProperty('binary');
    expect(report).toHaveProperty('project');
    expect(report).toHaveProperty('nextSteps');
    expect(report.backend).toBe('codebase-memory');
    expect(Array.isArray(report.nextSteps)).toBe(true);
  });
});

describe('runCodebaseMemoryDoctor — healthy path', () => {
  it('ok=true when binary is found and project is indexed', async () => {
    const { client } = mockClient({
      list_projects: okList([{ name: 'repo', root: '/repo', indexed: true }]),
    });
    const report = await runCodebaseMemoryDoctor(client, '/repo');

    expect(report.ok).toBe(true);
    expect(report.binary.found).toBe(true);
    expect(report.project.found).toBe(true);
    expect(report.project.name).toBe('repo');
    expect(report.nextSteps).toEqual([]);
  });
});

describe('runCodebaseMemoryDoctor — binary missing', () => {
  it('ok=false, binary.found=false, with an install-oriented next step', async () => {
    const { client } = mockClient({
      list_projects: {
        ok: false,
        diagnostic: createDiagnostic(
          'binary-missing',
          'Codebase Memory backend "codebase-memory-mcp" was not found.',
          {
            nextSteps: [
              'Ensure "codebase-memory-mcp" is installed and on PATH, or configure queryBackends.codebaseMemory.command.',
            ],
          }
        ),
      },
      command: 'codebase-memory-mcp',
    });
    const report = await runCodebaseMemoryDoctor(client, '/repo');

    expect(report.ok).toBe(false);
    expect(report.binary.found).toBe(false);
    // When the binary is missing, project resolution cannot proceed.
    expect(report.project.found).toBe(false);
    expect(report.nextSteps.length).toBeGreaterThan(0);
    expect(report.nextSteps.join('\n')).toMatch(/install|PATH|command/i);
  });
});

describe('runCodebaseMemoryDoctor — not indexed', () => {
  it('ok=false with an index_repository next step when project is not indexed', async () => {
    // list_projects succeeds but does not contain the target repo.
    const { client } = mockClient({
      list_projects: okList([{ name: 'other', root: '/other', indexed: true }]),
    });
    const report = await runCodebaseMemoryDoctor(client, '/repo');

    expect(report.ok).toBe(false);
    expect(report.binary.found).toBe(true);
    expect(report.project.found).toBe(false);
    expect(report.project.root).toBe('/repo');
    expect(report.nextSteps.some((s) => s.includes('index_repository'))).toBe(true);
    expect(report.nextSteps.join('\n')).toContain('/repo');
  });

  it('emits an index_repository next step when the matched project is not indexed', async () => {
    const { client } = mockClient({
      list_projects: okList([{ name: 'repo', root: '/repo', indexed: false }]),
    });
    const report = await runCodebaseMemoryDoctor(client, '/repo');

    expect(report.ok).toBe(false);
    expect(report.binary.found).toBe(true);
    expect(report.project.found).toBe(true);
    expect(report.project.name).toBe('repo');
    expect(report.project.indexed).toBe(false);
    expect(report.nextSteps.some((s) => s.includes('index_repository'))).toBe(true);
  });
});

describe('runCodebaseMemoryDoctor — ambiguous project', () => {
  it('ok=false and surfaces an ambiguity diagnostic when multiple projects match', async () => {
    const { client } = mockClient({
      list_projects: okList([
        { name: 'a', root: '/dup', indexed: true },
        { name: 'b', root: '/dup', indexed: true },
      ]),
    });
    const report = await runCodebaseMemoryDoctor(client, '/dup');

    expect(report.ok).toBe(false);
    expect(report.binary.found).toBe(true);
    expect(report.project.found).toBe(false);
    expect(report.diagnostics?.some((d) => d.code === 'project-ambiguous')).toBe(true);
  });
});

describe('runCodebaseMemoryDoctor — read-only guarantee', () => {
  it('only ever calls list_projects (never index/search/write tools)', async () => {
    const { client, calls } = mockClient({
      list_projects: okList([{ name: 'repo', root: '/repo', indexed: true }]),
    });
    await runCodebaseMemoryDoctor(client, '/repo');

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.tool).toBe('list_projects');
    }
    // Explicitly assert no mutating tools were touched.
    const mutating = ['index_repository', 'delete_project', 'update_index'];
    for (const tool of mutating) {
      expect(calls.find((c) => c.tool === tool)).toBeUndefined();
    }
  });

  it('does not call list_projects with any arguments (pure read)', async () => {
    const { client, calls } = mockClient({
      list_projects: okList([{ name: 'repo', root: '/repo', indexed: true }]),
    });
    await runCodebaseMemoryDoctor(client, '/repo');

    const listCall = calls.find((c) => c.tool === 'list_projects');
    expect(listCall).toBeDefined();
    expect(listCall?.args).toBeUndefined();
  });
});
