import type { GoRawData } from '../types.js';
import type { PackageGraph, CapabilityGraph, GoroutineTopology, FlowGraph } from './types.js';
import type { AtlasGenerationOptions } from './types.js';
import {
  PackageGraphBuilder,
  CapabilityGraphBuilder,
  GoroutineTopologyBuilder,
  FlowGraphBuilder,
} from './builders/index.js';
import { GoModResolver } from './go-mod-resolver.js';
import { InterfaceMatcher } from '../interface-matcher.js';

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
    if (!rawData.implementations?.length) {
      // Use fullName as packageName so InterfaceMatcher produces unambiguous
      // structPackageId / interfacePackageId values (full import path, not short name).
      // Without this, two packages sharing the same short name (e.g. both named "store")
      // would produce ambiguous package IDs and cause impl edges to be attributed to
      // the wrong struct.
      const structs = rawData.packages.flatMap((p) =>
        (p.structs || []).map((s) => ({ ...s, packageName: p.fullName }))
      );
      const interfaces = rawData.packages.flatMap((p) =>
        (p.interfaces || []).map((i) => ({ ...i, packageName: p.fullName }))
      );
      rawData.implementations = new InterfaceMatcher().matchImplicitImplementations(
        structs,
        interfaces
      );
    }
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
