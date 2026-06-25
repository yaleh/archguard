/**
 * Phase 91 TDD tests for ArchJsonMapper.mapCallRelations()
 *
 * Maps Go Atlas FlowGraph CallEdges to ArchJSON Relation[] with type='call'.
 */

import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '../../../src/plugins/golang/archjson-mapper.js';
import type { FlowGraph } from '../../../src/types/extensions/go-atlas.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalFlowGraph: FlowGraph = {
  entryPoints: [],
  callChains: [
    {
      id: 'chain-1',
      entryPoint: 'ep-1',
      calls: [
        { from: 'api.handleUser', to: 'svc.Save', type: 'direct', confidence: 0.9 },
        { from: 'api.handleUser', to: 'svc.store.Save', type: 'interface', confidence: 0.7 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArchJsonMapper.mapCallRelations()', () => {
  const mapper = new ArchJsonMapper();

  it('returns empty array when flowGraph is undefined', () => {
    expect(mapper.mapCallRelations(undefined)).toEqual([]);
  });

  it('returns empty array for flowGraph with no call chains', () => {
    const empty: FlowGraph = { entryPoints: [], callChains: [] };
    expect(mapper.mapCallRelations(empty)).toEqual([]);
  });

  it('returns 2 relations for 2 distinct edges', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    expect(results).toHaveLength(2);
  });

  it('all produced relations have type="call"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    for (const rel of results) {
      expect(rel.type).toBe('call');
    }
  });

  it('simple "api.handleUser" edge: source="api", sourceMethod="handleUser"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const rel = results.find((r) => r.sourceMethod === 'handleUser' && r.target === 'svc');
    expect(rel).toBeDefined();
    expect(rel.source).toBe('api');
    expect(rel.sourceMethod).toBe('handleUser');
  });

  it('simple "svc.Save" edge: target="svc", targetMethod="Save"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const rel = results.find((r) => r.target === 'svc' && r.targetMethod === 'Save');
    expect(rel).toBeDefined();
    expect(rel.target).toBe('svc');
    expect(rel.targetMethod).toBe('Save');
  });

  it('multi-level "svc.store.Save": target="svc.store", targetMethod="Save"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const rel = results.find((r) => r.target === 'svc.store');
    expect(rel).toBeDefined();
    expect(rel.targetMethod).toBe('Save');
  });

  it('deduplicates identical from/to pairs', () => {
    const withDupe: FlowGraph = {
      entryPoints: [],
      callChains: [
        {
          id: 'chain-1',
          entryPoint: 'ep-1',
          calls: [
            { from: 'api.handleUser', to: 'svc.Save', type: 'direct', confidence: 0.9 },
            { from: 'api.handleUser', to: 'svc.Save', type: 'direct', confidence: 0.9 }, // duplicate
          ],
        },
      ],
    };
    const results = mapper.mapCallRelations(withDupe);
    expect(results).toHaveLength(1);
  });

  it('skips edge where "from" has no dot (no package prefix)', () => {
    const missingPkg: FlowGraph = {
      entryPoints: [],
      callChains: [
        {
          id: 'chain-1',
          entryPoint: 'ep-1',
          calls: [
            { from: 'main', to: 'svc.Save', type: 'direct', confidence: 0.9 }, // no dot in from
          ],
        },
      ],
    };
    expect(mapper.mapCallRelations(missingPkg)).toHaveLength(0);
  });

  it('skips edge where "to" has no dot (no package prefix)', () => {
    const missingPkg: FlowGraph = {
      entryPoints: [],
      callChains: [
        {
          id: 'chain-1',
          entryPoint: 'ep-1',
          calls: [
            { from: 'api.handleUser', to: 'Save', type: 'direct', confidence: 0.9 }, // no dot in to
          ],
        },
      ],
    };
    expect(mapper.mapCallRelations(missingPkg)).toHaveLength(0);
  });

  it('all produced relations have inferenceSource="gopls"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    for (const rel of results) {
      expect(rel.inferenceSource).toBe('gopls');
    }
  });

  it('callType maps correctly: edge.type="direct" → callType="direct"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const directRel = results.find((r) => r.target === 'svc' && r.targetMethod === 'Save');
    expect(directRel.callType).toBe('direct');
  });

  it('callType maps correctly: edge.type="interface" → callType="interface"', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const ifaceRel = results.find((r) => r.target === 'svc.store');
    expect(ifaceRel.callType).toBe('interface');
  });

  it('callType maps correctly: edge.type="indirect" → callType="interface"', () => {
    const withIndirect: FlowGraph = {
      entryPoints: [],
      callChains: [
        {
          id: 'chain-1',
          entryPoint: 'ep-1',
          calls: [{ from: 'api.handler', to: 'db.Query', type: 'indirect', confidence: 0.5 }],
        },
      ],
    };
    const results = mapper.mapCallRelations(withIndirect);
    expect(results[0].callType).toBe('interface');
  });

  it('confidence is propagated from edge to relation', () => {
    const results = mapper.mapCallRelations(minimalFlowGraph);
    const rel = results.find((r) => r.target === 'svc' && r.targetMethod === 'Save');
    expect(rel.confidence).toBe(0.9);
  });

  it('deduplication works across multiple chains', () => {
    const multiChain: FlowGraph = {
      entryPoints: [],
      callChains: [
        {
          id: 'chain-1',
          entryPoint: 'ep-1',
          calls: [{ from: 'api.handleUser', to: 'svc.Save', type: 'direct', confidence: 0.9 }],
        },
        {
          id: 'chain-2',
          entryPoint: 'ep-2',
          calls: [{ from: 'api.handleUser', to: 'svc.Save', type: 'direct', confidence: 0.8 }], // same from/to, different chain
        },
      ],
    };
    expect(mapper.mapCallRelations(multiChain)).toHaveLength(1);
  });
});
