import { describe, it, expect } from 'vitest';
import type { IAtlasBuilder } from '@/plugins/golang/atlas/builders/i-atlas-builder.js';
import { PackageGraphBuilder } from '@/plugins/golang/atlas/builders/package-graph-builder.js';
import { CapabilityGraphBuilder } from '@/plugins/golang/atlas/builders/capability-graph-builder.js';
import { GoroutineTopologyBuilder } from '@/plugins/golang/atlas/builders/goroutine-topology-builder.js';
import { FlowGraphBuilder } from '@/plugins/golang/atlas/builders/flow-graph-builder.js';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type {
  PackageGraph,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
} from '@/plugins/golang/atlas/types.js';
import type { GoRawData } from '@/plugins/golang/types.js';

const emptyRawData: GoRawData = {
  moduleName: 'test',
  packages: [],
  implementations: [],
};

describe('IAtlasBuilder contract', () => {
  describe('PackageGraphBuilder', () => {
    it('has a build method', () => {
      const builder = new PackageGraphBuilder(new GoModResolver('test'));
      expect(typeof builder.build).toBe('function');
    });

    it('can be assigned to IAtlasBuilder<PackageGraph>', () => {
      const builder: IAtlasBuilder<PackageGraph> = new PackageGraphBuilder(new GoModResolver('test'));
      expect(builder).toBeDefined();
    });

    it('build(emptyRawData) resolves to object with nodes, edges, cycles', async () => {
      const builder = new PackageGraphBuilder(new GoModResolver('test'));
      const result = await builder.build(emptyRawData);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('cycles');
    });
  });

  describe('CapabilityGraphBuilder', () => {
    it('has a build method', () => {
      const builder = new CapabilityGraphBuilder();
      expect(typeof builder.build).toBe('function');
    });

    it('can be assigned to IAtlasBuilder<CapabilityGraph>', () => {
      const builder: IAtlasBuilder<CapabilityGraph> = new CapabilityGraphBuilder();
      expect(builder).toBeDefined();
    });

    it('build(emptyRawData) resolves to object with nodes and edges', async () => {
      const builder = new CapabilityGraphBuilder();
      const result = await builder.build(emptyRawData);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });
  });

  describe('GoroutineTopologyBuilder', () => {
    it('has a build method', () => {
      const builder = new GoroutineTopologyBuilder();
      expect(typeof builder.build).toBe('function');
    });

    it('can be assigned to IAtlasBuilder<GoroutineTopology>', () => {
      const builder: IAtlasBuilder<GoroutineTopology> = new GoroutineTopologyBuilder();
      expect(builder).toBeDefined();
    });

    it('build(emptyRawData) resolves to object with nodes, edges, channels', async () => {
      const builder = new GoroutineTopologyBuilder();
      const result = await builder.build(emptyRawData);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('channels');
    });
  });

  describe('FlowGraphBuilder', () => {
    it('has a build method', () => {
      const builder = new FlowGraphBuilder();
      expect(typeof builder.build).toBe('function');
    });

    it('can be assigned to IAtlasBuilder<FlowGraph>', () => {
      const builder: IAtlasBuilder<FlowGraph> = new FlowGraphBuilder();
      expect(builder).toBeDefined();
    });

    it('build(emptyRawData) resolves to object with entryPoints and callChains', async () => {
      const builder = new FlowGraphBuilder();
      const result = await builder.build(emptyRawData);
      expect(result).toHaveProperty('entryPoints');
      expect(result).toHaveProperty('callChains');
    });
  });
});
