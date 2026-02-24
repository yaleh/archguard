import type { GoRawData } from '../types.js';
import type { PackageGraph, CapabilityGraph, GoroutineTopology, FlowGraph } from './types.js';
import type { AtlasGenerationOptions } from './types.js';
import { PackageGraphBuilder } from './builders/package-graph-builder.js';
import { CapabilityGraphBuilder } from './builders/capability-graph-builder.js';
import { GoroutineTopologyBuilder } from './builders/goroutine-topology-builder.js';
import { FlowGraphBuilder } from './builders/flow-graph-builder.js';
import { GoModResolver } from './go-mod-resolver.js';

/**
 * Behavior analysis coordinator
 *
 * Coordinates graph builders. No `any` types.
 */
export class BehaviorAnalyzer {
  private packageGraphBuilder: PackageGraphBuilder;
  private capabilityGraphBuilder: CapabilityGraphBuilder;
  private goroutineTopologyBuilder: GoroutineTopologyBuilder;
  private flowGraphBuilder: FlowGraphBuilder;

  constructor(goModResolver: GoModResolver) {
    this.packageGraphBuilder = new PackageGraphBuilder(goModResolver);
    this.capabilityGraphBuilder = new CapabilityGraphBuilder();
    this.goroutineTopologyBuilder = new GoroutineTopologyBuilder();
    this.flowGraphBuilder = new FlowGraphBuilder();
  }

  async buildPackageGraph(rawData: GoRawData): Promise<PackageGraph> {
    return this.packageGraphBuilder.build(rawData);
  }

  async buildCapabilityGraph(rawData: GoRawData): Promise<CapabilityGraph> {
    return this.capabilityGraphBuilder.build(rawData);
  }

  async buildGoroutineTopology(
    rawData: GoRawData,
    _options: Pick<AtlasGenerationOptions, 'includeTests'> = {}
  ): Promise<GoroutineTopology> {
    return this.goroutineTopologyBuilder.build(rawData);
  }

  async buildFlowGraph(
    rawData: GoRawData,
    _options: Pick<AtlasGenerationOptions, 'entryPointTypes' | 'followIndirectCalls'> = {}
  ): Promise<FlowGraph> {
    return this.flowGraphBuilder.build(rawData);
  }
}
