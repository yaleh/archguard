import { describe, it, expect } from 'vitest';
import { BehaviorAnalyzer } from '@/plugins/golang/atlas/behavior-analyzer.js';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type { GoRawData } from '@/plugins/golang/types.js';

function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
  return {
    packages: [],
    moduleRoot: '/test',
    moduleName: 'github.com/test/project',
    ...overrides,
  };
}

describe('BehaviorAnalyzer', () => {
  describe('constructor', () => {
    it('can be instantiated with a GoModResolver', () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      expect(analyzer).toBeDefined();
      expect(analyzer).toBeInstanceOf(BehaviorAnalyzer);
    });
  });

  describe('buildPackageGraph', () => {
    it('returns PackageGraph with nodes, edges, and cycles arrays for empty data', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildPackageGraph(rawData);

      expect(result).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
      expect(Array.isArray(result.cycles)).toBe(true);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.cycles).toHaveLength(0);
    });
  });

  describe('buildCapabilityGraph', () => {
    it('returns CapabilityGraph with nodes and edges arrays for empty data', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildCapabilityGraph(rawData);

      expect(result).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('auto-populates implementations when rawData.implementations is empty', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData({
        packages: [
          {
            id: 'pkg/api',
            name: 'api',
            fullName: 'pkg/api',
            dirPath: '/test/pkg/api',
            sourceFiles: ['api.go'],
            imports: [],
            structs: [
              {
                name: 'Server',
                packageName: 'pkg/api',
                fields: [],
                methods: [
                  {
                    name: 'ServeHTTP',
                    receiverType: 'Server',
                    parameters: [],
                    returnTypes: [],
                    exported: true,
                    location: { file: 'api.go', startLine: 10, endLine: 12 },
                  },
                ],
                embeddedTypes: [],
                exported: true,
                location: { file: 'api.go', startLine: 5, endLine: 8 },
              },
            ],
            interfaces: [
              {
                name: 'Handler',
                packageName: 'pkg/api',
                methods: [
                  {
                    name: 'ServeHTTP',
                    parameters: [],
                    returnTypes: [],
                    exported: true,
                    location: { file: 'api.go', startLine: 1, endLine: 3 },
                  },
                ],
                embeddedInterfaces: [],
                exported: true,
                location: { file: 'api.go', startLine: 1, endLine: 3 },
              },
            ],
            functions: [],
          },
        ],
        // implementations intentionally omitted (undefined)
      });

      expect(rawData.implementations).toBeUndefined();

      const result = await analyzer.buildCapabilityGraph(rawData);

      // InterfaceMatcher should have detected Server implements Handler
      const implEdges = result.edges.filter((e) => e.type === 'implements');
      expect(implEdges.length).toBeGreaterThan(0);

      const serverToHandler = implEdges.find(
        (e) => e.source === 'pkg/api.Server' && e.target === 'pkg/api.Handler'
      );
      expect(serverToHandler).toBeDefined();
    });
  });

  describe('buildGoroutineTopology', () => {
    it('returns GoroutineTopology with nodes, edges, and channels arrays for empty data', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildGoroutineTopology(rawData);

      expect(result).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
      expect(Array.isArray(result.channels)).toBe(true);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.channels).toHaveLength(0);
    });

    it('accepts options param (includeTests) without errors', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildGoroutineTopology(rawData, { includeTests: true });

      expect(result).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
    });
  });

  describe('buildFlowGraph', () => {
    it('returns FlowGraph with entryPoints and callChains arrays for empty data', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildFlowGraph(rawData);

      expect(result).toBeDefined();
      expect(Array.isArray(result.entryPoints)).toBe(true);
      expect(Array.isArray(result.callChains)).toBe(true);
      expect(result.entryPoints).toHaveLength(0);
      expect(result.callChains).toHaveLength(0);
    });

    it('accepts options param (entryPointTypes, followIndirectCalls) without errors', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const result = await analyzer.buildFlowGraph(rawData, {
        entryPointTypes: ['http-handler'],
        followIndirectCalls: true,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.entryPoints)).toBe(true);
    });
  });

  describe('all 4 builders in parallel', () => {
    it('resolves correctly when all builders run via Promise.all', async () => {
      const resolver = new GoModResolver();
      const analyzer = new BehaviorAnalyzer(resolver);
      const rawData = makeRawData();

      const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([
        analyzer.buildPackageGraph(rawData),
        analyzer.buildCapabilityGraph(rawData),
        analyzer.buildGoroutineTopology(rawData),
        analyzer.buildFlowGraph(rawData),
      ]);

      expect(packageGraph).toBeDefined();
      expect(Array.isArray(packageGraph.nodes)).toBe(true);
      expect(Array.isArray(packageGraph.edges)).toBe(true);
      expect(Array.isArray(packageGraph.cycles)).toBe(true);

      expect(capabilityGraph).toBeDefined();
      expect(Array.isArray(capabilityGraph.nodes)).toBe(true);
      expect(Array.isArray(capabilityGraph.edges)).toBe(true);

      expect(goroutineTopology).toBeDefined();
      expect(Array.isArray(goroutineTopology.nodes)).toBe(true);
      expect(Array.isArray(goroutineTopology.edges)).toBe(true);
      expect(Array.isArray(goroutineTopology.channels)).toBe(true);

      expect(flowGraph).toBeDefined();
      expect(Array.isArray(flowGraph.entryPoints)).toBe(true);
      expect(Array.isArray(flowGraph.callChains)).toBe(true);
    });
  });
});
