/**
 * Smoke tests for MermaidTemplates façade — one per atlas layer.
 *
 * Full per-layer coverage lives in tests/plugins/golang/atlas/renderers/:
 *   package-renderer.test.ts, capability-renderer.test.ts,
 *   goroutine-renderer.test.ts, flow-renderer.test.ts
 */
import { describe, it, expect } from 'vitest';
import { MermaidTemplates } from '@/plugins/golang/atlas/renderers/mermaid-templates.js';
import type { PackageGraph } from '@/types/extensions/go-atlas.js';
import type { CapabilityGraph, CapabilityNode } from '@/plugins/golang/atlas/types.js';
import type {
  GoroutineTopology,
  GoroutineNode,
  FlowGraph,
  EntryPoint,
} from '@/types/extensions/go-atlas.js';

// ─── Package layer ────────────────────────────────────────────────────────────

describe('MermaidTemplates.renderPackageGraph — smoke', () => {
  it('returns a flowchart string for a minimal package graph', () => {
    const graph: PackageGraph = {
      nodes: [{ id: 'pkg/api', name: 'api', type: 'internal', fileCount: 3 }],
      edges: [],
      cycles: [],
    };
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/flowchart|graph/);
  });
});

// ─── Capability layer ─────────────────────────────────────────────────────────

describe('MermaidTemplates.renderCapabilityGraph — smoke', () => {
  it('returns a flowchart string for a minimal capability graph', () => {
    const node: CapabilityNode = {
      id: 'pkg/api.Handler',
      name: 'Handler',
      package: 'pkg/api',
      type: 'interface',
      exported: true,
    };
    const graph: CapabilityGraph = { nodes: [node], edges: [] };
    const result = MermaidTemplates.renderCapabilityGraph(graph);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/flowchart|graph/);
  });
});

// ─── Goroutine layer ──────────────────────────────────────────────────────────

describe('MermaidTemplates.renderGoroutineTopology — smoke', () => {
  it('returns a non-empty string for a minimal goroutine topology', () => {
    const node: GoroutineNode = {
      id: 'spawn-1',
      name: 'worker',
      type: 'spawned',
      package: 'pkg/worker',
      location: { file: '/srv/worker/worker.go', line: 10 },
    };
    const topology: GoroutineTopology = {
      nodes: [node],
      edges: [],
      channels: [],
      channelEdges: [],
    };
    const result = MermaidTemplates.renderGoroutineTopology(topology);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── Flow layer ───────────────────────────────────────────────────────────────

describe('MermaidTemplates.renderFlowGraph — smoke', () => {
  it('returns a flowchart LR string for a minimal flow graph', () => {
    const entry: EntryPoint = {
      id: 'ep1',
      protocol: 'http',
      method: 'GET',
      framework: 'net/http',
      path: '/health',
      handler: 'pkg/api.Health',
      middleware: [],
      location: { file: '/srv/api/health.go', line: 10 },
    };
    const graph: FlowGraph = { entryPoints: [entry], callChains: [] };
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(typeof result).toBe('string');
    expect(result).toContain('flowchart LR');
    expect(result).toContain('ep1');
  });
});
