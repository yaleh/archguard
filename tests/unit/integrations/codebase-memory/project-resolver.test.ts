import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveProject } from '@/integrations/codebase-memory/project-resolver.js';
import type {
  CodebaseMemoryClient,
  ClientCallResult,
} from '@/integrations/codebase-memory/client.js';
import { createDiagnostic } from '@/integrations/codebase-memory/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../fixtures/codebase-memory');

const listProjectsFixture = JSON.parse(
  readFileSync(resolve(FIXTURES, 'list_projects.json'), 'utf8')
);

/** A mock client whose `call` resolves a fixed result. */
function mockClient(result: ClientCallResult<unknown>): CodebaseMemoryClient {
  return { call: vi.fn(async () => result) } as unknown as CodebaseMemoryClient;
}

const okList = (): ClientCallResult<unknown> => ({
  ok: true,
  data: listProjectsFixture,
  stderr: '',
});

describe('resolveProject — exact path match', () => {
  it('prefers an exact root-path match', async () => {
    const client = mockClient(okList());
    const res = await resolveProject(client, '/Users/me/work/orders-service');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.project).toBe('orders-service');
      expect(res.matchedBy).toBe('exact-path');
    }
  });

  it('matches exact path even when a trailing slash is present', async () => {
    const client = mockClient(okList());
    const res = await resolveProject(client, '/Users/me/work/archguard/');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.project).toBe('archguard');
      expect(res.matchedBy).toBe('exact-path');
    }
  });
});

describe('resolveProject — directory-name match', () => {
  it('falls back to a unique directory-name match when no exact path', async () => {
    // Basename "archguard" matches project name "archguard"; path differs.
    const client = mockClient(okList());
    const res = await resolveProject(client, '/some/other/place/archguard');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.project).toBe('archguard');
      expect(res.matchedBy).toBe('directory-name');
    }
  });
});

describe('resolveProject — ambiguous', () => {
  it('returns an ambiguity diagnostic when two projects share a directory name', async () => {
    // Two fixture projects both have basename "orders-service":
    //   name "orders-service"      root .../work/orders-service
    //   name "orders-service-fork" root .../work/forks/orders-service
    // Add a duplicate-name project to force directory-name ambiguity.
    const data = {
      projects: [
        { name: 'orders-service', root: '/a/orders-service' },
        { name: 'orders-service', root: '/b/orders-service' },
      ],
    };
    const client = mockClient({ ok: true, data, stderr: '' });
    const res = await resolveProject(client, '/elsewhere/orders-service');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('project-ambiguous');
      expect(res.diagnostic.message).toContain('orders-service');
    }
  });

  it('returns an ambiguity diagnostic when multiple exact-path entries match', async () => {
    const data = {
      projects: [
        { name: 'one', root: '/repo' },
        { name: 'two', root: '/repo' },
      ],
    };
    const client = mockClient({ ok: true, data, stderr: '' });
    const res = await resolveProject(client, '/repo');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('project-ambiguous');
      expect(res.diagnostic.nextSteps).toEqual(['--cbm-project one', '--cbm-project two']);
    }
  });
});

describe('resolveProject — not indexed', () => {
  it('returns a not-indexed diagnostic with an index_repository next step', async () => {
    const client = mockClient(okList());
    const res = await resolveProject(client, '/totally/unknown/repo');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('project-not-indexed');
      expect(res.diagnostic.nextSteps?.[0]).toContain('index_repository');
      expect(res.diagnostic.nextSteps?.[0]).toContain('/totally/unknown/repo');
    }
  });

  it('treats an empty project list as not indexed', async () => {
    const client = mockClient({ ok: true, data: { projects: [] }, stderr: '' });
    const res = await resolveProject(client, '/repo');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic.code).toBe('project-not-indexed');
    }
  });
});

describe('resolveProject — client failure passthrough', () => {
  it('surfaces the client diagnostic when list_projects fails', async () => {
    const diagnostic = createDiagnostic('binary-missing', 'no binary');
    const client = mockClient({ ok: false, diagnostic });
    const res = await resolveProject(client, '/repo');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostic).toBe(diagnostic);
    }
  });
});
