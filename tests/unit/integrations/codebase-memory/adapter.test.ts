import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CodebaseMemoryAdapter } from '@/integrations/codebase-memory/adapter.js';
import type {
  CodebaseMemoryClient,
  ClientCallResult,
} from '@/integrations/codebase-memory/client.js';
import { createDiagnostic } from '@/integrations/codebase-memory/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../fixtures/codebase-memory');

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));

const listProjects = fixture('list_projects.json');
const searchGraphClass = fixture('search_graph.class.json');
const tracePathInbound = fixture('trace_path.inbound.json');
const codeSnippet = fixture('get_code_snippet.json');
const architecture = fixture('get_architecture.json');

const PROJECT_ROOT = '/Users/me/work/orders-service';

/**
 * Build a mock client that dispatches per-tool canned results. `calls` records
 * every (tool, args) invocation for assertions.
 */
interface MockClient {
  client: CodebaseMemoryClient;
  calls: Array<{ tool: string; args?: Record<string, unknown> }>;
}

function mockClient(handlers: Record<string, ClientCallResult<unknown>>): MockClient {
  const calls: Array<{ tool: string; args?: Record<string, unknown> }> = [];
  const call = vi.fn((tool: string, args?: Record<string, unknown>) => {
    calls.push({ tool, args });
    const result =
      handlers[tool] ??
      ({
        ok: false,
        diagnostic: createDiagnostic('unsupported', `no mock for ${tool}`),
      } as ClientCallResult<unknown>);
    return Promise.resolve(result);
  });
  return { client: { call } as unknown as CodebaseMemoryClient, calls };
}

const okList = (): ClientCallResult<unknown> => ({
  ok: true,
  data: listProjects,
  stderr: '',
});

function makeAdapter(handlers: Record<string, ClientCallResult<unknown>>): {
  adapter: CodebaseMemoryAdapter;
  calls: MockClient['calls'];
} {
  const { client, calls } = mockClient(handlers);
  const adapter = new CodebaseMemoryAdapter(client, { projectRoot: PROJECT_ROOT });
  return { adapter, calls };
}

// ---------------------------------------------------------------------------
// Phase A: findEntity / getFileEntities -> search_graph
// ---------------------------------------------------------------------------

describe('CodebaseMemoryAdapter.findEntity', () => {
  it('maps findEntity to search_graph with a name_pattern and limit', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: searchGraphClass, stderr: '' },
    });

    const res = await adapter.findEntity('OrderHandler');

    expect(res.backend).toBe('codebase-memory');
    expect(res.projectRoot).toBe(PROJECT_ROOT);
    expect(res.codebaseMemoryProject).toBe('orders-service');

    const searchCall = calls.find((c) => c.tool === 'search_graph');
    expect(searchCall).toBeDefined();
    expect(searchCall?.args?.project).toBe('orders-service');
    expect(searchCall?.args?.name_pattern).toContain('OrderHandler');
    expect(typeof searchCall?.args?.limit).toBe('number');

    expect(res.data.results).toHaveLength(2);
    const first = res.data.results[0];
    expect(first.name).toBe('OrderHandler');
    expect(first.qualifiedName).toBe('src.orders.OrderHandler');
    expect(first.kind).toBe('Class');
    expect(first.file).toBe('src/orders/order-handler.ts');
    // Lossless raw is preserved, not faked as an ArchGuard entity.
    expect(first.raw).toMatchObject({ qualified_name: 'src.orders.OrderHandler' });
  });

  it('escapes regex-special characters in the name pattern', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: { results: [] }, stderr: '' },
    });

    await adapter.findEntity('Order.Handler+');
    const searchCall = calls.find((c) => c.tool === 'search_graph');
    const pattern = searchCall?.args?.name_pattern as string;
    expect(pattern).toContain('Order\\.Handler\\+');
  });

  it('caps results at the requested limit', async () => {
    const big = { results: Array.from({ length: 50 }, (_, i) => ({ name: `E${i}` })) };
    const { adapter } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: big, stderr: '' },
    });
    const res = await adapter.findEntity('E', { limit: 5 });
    expect(res.data.results).toHaveLength(5);
  });

  it('surfaces a diagnostic when the project cannot be resolved', async () => {
    const { adapter } = makeAdapter({
      list_projects: { ok: true, data: { projects: [] }, stderr: '' },
    });
    const res = await adapter.findEntity('OrderHandler');
    expect(res.diagnostics?.[0]?.code).toBe('project-not-indexed');
    expect(res.data.results).toEqual([]);
  });

  it('surfaces the client diagnostic when search_graph fails', async () => {
    const { adapter } = makeAdapter({
      list_projects: okList(),
      search_graph: {
        ok: false,
        diagnostic: createDiagnostic('backend-error', 'boom'),
      },
    });
    const res = await adapter.findEntity('OrderHandler');
    expect(res.diagnostics?.[0]?.code).toBe('backend-error');
    expect(res.data.results).toEqual([]);
  });
});

describe('CodebaseMemoryAdapter.getFileEntities', () => {
  it('maps getFileEntities to search_graph with a file_pattern', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: searchGraphClass, stderr: '' },
    });

    const res = await adapter.getFileEntities('src/orders/order-handler.ts');
    const searchCall = calls.find((c) => c.tool === 'search_graph');
    expect(searchCall?.args?.file_pattern).toBe('src/orders/order-handler.ts');
    expect(searchCall?.args?.name_pattern).toBeUndefined();
    expect(res.data.file).toBe('src/orders/order-handler.ts');
    expect(res.data.results).toHaveLength(2);
  });

  it('uses a higher default limit for file entities than entity search', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: { results: [] }, stderr: '' },
    });
    await adapter.getFileEntities('src/x.ts');
    const fileLimit = calls.find((c) => c.tool === 'search_graph')?.args?.limit as number;

    const { adapter: a2, calls: c2 } = makeAdapter({
      list_projects: okList(),
      search_graph: { ok: true, data: { results: [] }, stderr: '' },
    });
    await a2.findEntity('X');
    const entityLimit = c2.find((c) => c.tool === 'search_graph')?.args?.limit as number;

    expect(fileLimit).toBeGreaterThan(entityLimit);
  });
});

// ---------------------------------------------------------------------------
// Phase B: findCallers -> trace_path(inbound) with search_graph fallback
// ---------------------------------------------------------------------------

describe('CodebaseMemoryAdapter.findCallers', () => {
  it('maps findCallers to trace_path with direction inbound', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      trace_path: { ok: true, data: tracePathInbound, stderr: '' },
    });

    const res = await adapter.findCallers('OrderHandler.handle');
    const traceCall = calls.find((c) => c.tool === 'trace_path');
    expect(traceCall).toBeDefined();
    expect(traceCall?.args?.direction).toBe('inbound');
    expect(traceCall?.args?.function_name).toBe('OrderHandler.handle');
    expect(traceCall?.args?.project).toBe('orders-service');

    expect(res.data.callers).toHaveLength(2);
    expect(res.data.callers[0].from).toBe('OrderController.create');
    expect(res.data.callers[0].to).toBe('OrderHandler.handle');
    // search_graph must NOT have been called on success.
    expect(calls.some((c) => c.tool === 'search_graph')).toBe(false);
  });

  it('caps callers at the requested limit', async () => {
    const many = {
      paths: Array.from({ length: 40 }, (_, i) => ({
        from: `Caller${i}.fn`,
        to: 'Target.fn',
      })),
    };
    const { adapter } = makeAdapter({
      list_projects: okList(),
      trace_path: { ok: true, data: many, stderr: '' },
    });
    const res = await adapter.findCallers('Target.fn', { limit: 10 });
    expect(res.data.callers).toHaveLength(10);
  });

  it('falls back to search_graph candidates when trace_path fails', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      trace_path: {
        ok: false,
        diagnostic: createDiagnostic('backend-error', 'no such function'),
      },
      search_graph: { ok: true, data: searchGraphClass, stderr: '' },
    });

    const res = await adapter.findCallers('OrderHandler');
    // trace failed -> no callers, but candidates offered for disambiguation.
    expect(res.data.callers).toEqual([]);
    expect(res.data.candidates).toBeDefined();
    expect(res.data.candidates?.length).toBeGreaterThan(0);
    expect(res.data.candidates?.[0].qualifiedName).toBe('src.orders.OrderHandler');
    expect(calls.some((c) => c.tool === 'search_graph')).toBe(true);
    expect(res.diagnostics?.some((d) => d.code === 'backend-error')).toBe(true);
  });

  it('reports a diagnostic when trace fails and no candidates are found', async () => {
    const { adapter } = makeAdapter({
      list_projects: okList(),
      trace_path: {
        ok: false,
        diagnostic: createDiagnostic('backend-error', 'no such function'),
      },
      search_graph: { ok: true, data: { results: [] }, stderr: '' },
    });
    const res = await adapter.findCallers('Nope');
    expect(res.data.callers).toEqual([]);
    expect(res.data.candidates).toEqual([]);
    expect(res.diagnostics?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phase C: snippet enrichment -> get_code_snippet, summary -> get_architecture
// ---------------------------------------------------------------------------

describe('CodebaseMemoryAdapter.getCodeSnippet', () => {
  it('maps getCodeSnippet to get_code_snippet with a qualified_name', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      get_code_snippet: { ok: true, data: codeSnippet, stderr: '' },
    });

    const res = await adapter.getCodeSnippet('src.orders.OrderHandler');
    const call = calls.find((c) => c.tool === 'get_code_snippet');
    expect(call?.args?.qualified_name).toBe('src.orders.OrderHandler');
    expect(call?.args?.include_neighbors).toBe(true);
    expect(res.data.qualifiedName).toBe('src.orders.OrderHandler');
    expect(res.data.snippet).toContain('class OrderHandler');
    expect(res.data.file).toBe('src/orders/order-handler.ts');
  });

  it('truncates oversized snippets to bound the response', async () => {
    const huge = {
      qualified_name: 'x.Y',
      file: 'x.ts',
      snippet: 'a'.repeat(10_000),
    };
    const { adapter } = makeAdapter({
      list_projects: okList(),
      get_code_snippet: { ok: true, data: huge, stderr: '' },
    });
    const res = await adapter.getCodeSnippet('x.Y', { maxSnippetChars: 200 });
    expect(res.data.snippet.length).toBeLessThanOrEqual(200 + 32);
    expect(res.data.truncated).toBe(true);
  });

  it('passes through a client diagnostic on snippet failure', async () => {
    const { adapter } = makeAdapter({
      list_projects: okList(),
      get_code_snippet: {
        ok: false,
        diagnostic: createDiagnostic('backend-error', 'missing'),
      },
    });
    const res = await adapter.getCodeSnippet('x.Y');
    expect(res.diagnostics?.[0]?.code).toBe('backend-error');
    expect(res.data.snippet).toBe('');
  });
});

describe('CodebaseMemoryAdapter.getArchitecture', () => {
  it('maps getArchitecture to get_architecture and wraps as enrichment', async () => {
    const { adapter, calls } = makeAdapter({
      list_projects: okList(),
      get_architecture: { ok: true, data: architecture, stderr: '' },
    });

    const res = await adapter.getArchitecture();
    const call = calls.find((c) => c.tool === 'get_architecture');
    expect(call?.args?.project).toBe('orders-service');
    expect(res.backend).toBe('codebase-memory');
    // The raw architecture payload is preserved under source/raw, not faked.
    expect(res.data.raw).toMatchObject({ project: 'orders-service' });
  });

  it('surfaces the diagnostic when get_architecture fails', async () => {
    const { adapter } = makeAdapter({
      list_projects: okList(),
      get_architecture: {
        ok: false,
        diagnostic: createDiagnostic('backend-error', 'no arch'),
      },
    });
    const res = await adapter.getArchitecture();
    expect(res.diagnostics?.[0]?.code).toBe('backend-error');
    expect(res.data.raw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Explicit project override skips resolution
// ---------------------------------------------------------------------------

describe('CodebaseMemoryAdapter — explicit project', () => {
  it('uses an explicitly provided project and skips list_projects', async () => {
    const { client, calls } = mockClient({
      search_graph: { ok: true, data: searchGraphClass, stderr: '' },
    });
    const adapter = new CodebaseMemoryAdapter(client, {
      projectRoot: PROJECT_ROOT,
      project: 'pinned-project',
    });
    const res = await adapter.findEntity('OrderHandler');
    expect(calls.some((c) => c.tool === 'list_projects')).toBe(false);
    expect(res.codebaseMemoryProject).toBe('pinned-project');
    expect(calls.find((c) => c.tool === 'search_graph')?.args?.project).toBe('pinned-project');
  });
});
