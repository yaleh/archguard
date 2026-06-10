import { describe, it, expect } from 'vitest';
import { renderFlowGraph } from '@/plugins/golang/atlas/renderers/flow-mermaid-template.js';
import type { FlowGraph, EntryPoint } from '@/types/extensions/go-atlas.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<EntryPoint> & { id: string }): EntryPoint {
  return {
    protocol: 'http',
    method: 'GET',
    framework: 'net/http',
    path: '/api/resource',
    handler: 'pkg.Handler',
    middleware: [],
    location: { file: '/srv/api/handler.go', line: 10 },
    ...overrides,
  };
}

function makeFlowGraph(entries: EntryPoint[], callChains = []): FlowGraph {
  return { entryPoints: entries, callChains };
}

// ─── flowchart format (default) ───────────────────────────────────────────────

describe('renderFlowGraph — direct import (flowchart)', () => {
  it('empty flow graph returns valid Mermaid string', () => {
    const graph = makeFlowGraph([]);
    const result = renderFlowGraph(graph);
    expect(typeof result).toBe('string');
    expect(result).toContain('flowchart LR');
  });

  it('empty flow graph includes init directive', () => {
    const graph = makeFlowGraph([]);
    const result = renderFlowGraph(graph);
    expect(result).toMatch(/%%\{init:/);
  });

  it('single entry point appears in output', () => {
    const entry = makeEntry({ id: 'ep1', handler: 'MyHandler', path: '/foo' });
    const graph = makeFlowGraph([entry]);
    const result = renderFlowGraph(graph);
    expect(result).toContain('ep1');
  });

  it('flowchart format starts with flowchart config', () => {
    const graph = makeFlowGraph([makeEntry({ id: 'ep1' })]);
    const result = renderFlowGraph(graph);
    expect(result).toMatch(/%%\{init:.*\}%%\nflowchart LR/);
  });

  it('sequence format starts with sequenceDiagram', () => {
    const graph = makeFlowGraph([]);
    const result = renderFlowGraph(graph, 'sequence');
    expect(result).toContain('sequenceDiagram');
  });

  it('sequence format includes sequence init directive', () => {
    const graph = makeFlowGraph([]);
    const result = renderFlowGraph(graph, 'sequence');
    expect(result).toMatch(/%%\{init:.*sequence.*\}%%/);
  });

  it('entry point subgraph uses package name as label when package set', () => {
    const entry = makeEntry({
      id: 'ep1',
      package: 'pkg/hub',
      location: { file: '/abs/pkg/hub/handler.go', line: 1 },
    });
    const graph = makeFlowGraph([entry]);
    const result = renderFlowGraph(graph);
    expect(result).toContain('"pkg/hub"');
    expect(result).not.toContain('/abs/pkg/hub');
  });

  it('entry with GET method appears with GET label', () => {
    const entry = makeEntry({ id: 'ep1', protocol: 'http', method: 'GET', path: '/users' });
    const graph = makeFlowGraph([entry]);
    const result = renderFlowGraph(graph);
    expect(result).toContain('"GET /users"');
  });

  it('entry with gRPC protocol appears with gRPC label', () => {
    const entry = makeEntry({
      id: 'ep1',
      protocol: 'grpc',
      method: undefined,
      path: '/pkg.Svc/Call',
    });
    const graph = makeFlowGraph([entry]);
    const result = renderFlowGraph(graph);
    expect(result).toContain('"gRPC /pkg.Svc/Call"');
  });

  it('snapshot: complete realistic flow graph with call chain', () => {
    const entry = makeEntry({
      id: 'entry-pkg/hub-1',
      protocol: 'http',
      method: 'POST',
      path: '/api/items',
      handler: 'hub.CreateItem',
      package: 'pkg/hub',
      location: { file: '/abs/pkg/hub/handler.go', line: 10 },
    });
    const graph: FlowGraph = {
      entryPoints: [entry],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [
            { from: 'hub.CreateItem', to: 'store.Save', type: 'direct', confidence: 0.9 },
            { from: 'store.Save', to: 'db.Exec', type: 'direct', confidence: 0.9 },
          ],
        },
      ],
    };
    const result = renderFlowGraph(graph);
    expect(result).toContain('flowchart LR');
    expect(result).toContain('"pkg/hub"');
    expect(result).toContain('"POST /api/items"');
    expect(result).toContain('hub_CreateItem');
    expect(result).toContain('store_Save');
    expect(result).toContain('db_Exec');
    expect(result).toContain('classDef entry');
    expect(result).toContain('classDef handler');
    expect(result).toContain('classDef util');
  });
});

// ─── sequence format ──────────────────────────────────────────────────────────

describe('renderFlowGraph — direct import (sequence)', () => {
  it('emits Note over handler with path label', () => {
    const entry = makeEntry({ id: 'ep1', handler: 'myHandler', path: '/users' });
    const graph: FlowGraph = {
      entryPoints: [entry],
      callChains: [{ id: 'chain1', entryPoint: 'ep1', calls: [] }],
    };
    const result = renderFlowGraph(graph, 'sequence');
    expect(result).toContain('Note over myHandler');
    expect(result).toContain('/users');
  });

  it('emits call and return arrows for call chain entries', () => {
    const entry = makeEntry({ id: 'ep1', handler: 'myHandler' });
    const graph: FlowGraph = {
      entryPoints: [entry],
      callChains: [
        {
          id: 'chain1',
          entryPoint: 'ep1',
          calls: [{ from: 'myHandler', to: 'store.Get', type: 'direct', confidence: 0.7 }],
        },
      ],
    };
    const result = renderFlowGraph(graph, 'sequence');
    expect(result).toContain('myHandler->>+store_Get: call');
    expect(result).toContain('store_Get-->>-myHandler: return');
  });
});
