import type { GoRawData, GoRawPackage, GoSpawnStmt } from '../../types.js';
import type {
  GoroutineTopology,
  GoroutineNode,
  GoroutinePattern,
  SpawnRelation,
  ChannelInfo,
} from '../types.js';

/**
 * Goroutine topology builder
 *
 * Scans both functions AND methods for go spawn statements.
 * Output types from ADR-002 v1.2 (includes spawnType on GoroutineNode).
 */
export class GoroutineTopologyBuilder {
  build(rawData: GoRawData): Promise<GoroutineTopology> {
    const nodes = this.extractGoroutineNodes(rawData);
    const edges = this.buildSpawnRelations(rawData);
    const channels = this.extractChannelInfo(rawData);

    // Classify patterns
    for (const node of nodes) {
      node.pattern = this.classifyPattern(node, edges, channels);
    }

    return Promise.resolve({ nodes, edges, channels });
  }

  /**
   * Extract goroutine nodes from BOTH functions AND methods
   *
   * CRITICAL: Methods must also be scanned (not just top-level functions).
   * e.g., Server.Start() spawning goroutines via go s.handleConn()
   */
  private extractGoroutineNodes(rawData: GoRawData): GoroutineNode[] {
    const nodes: GoroutineNode[] = [];

    for (const pkg of rawData.packages) {
      // Scan standalone functions
      for (const func of pkg.functions) {
        if (func.name === 'main' && pkg.name === 'main') {
          nodes.push({
            id: 'main',
            name: 'main.main',
            type: 'main',
            package: pkg.fullName,
            location: { file: func.location.file, line: func.location.startLine },
          });
        }

        if (func.body) {
          this.extractSpawnedNodes(func.body.goSpawns, pkg, func.name, nodes);
        }
      }

      // Scan struct methods (IMPORTANT: don't skip these!)
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.body) {
            this.extractSpawnedNodes(
              method.body.goSpawns,
              pkg,
              `${struct.name}.${method.name}`,
              nodes
            );
          }
        }
      }
    }

    return nodes;
  }

  private extractSpawnedNodes(
    goSpawns: GoSpawnStmt[],
    pkg: GoRawPackage,
    parentName: string,
    nodes: GoroutineNode[]
  ): void {
    for (const spawn of goSpawns) {
      const isAnonymous = spawn.call.functionName === '<anonymous>';
      nodes.push({
        id: `${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}`,
        name: spawn.call.functionName,
        type: 'spawned',
        spawnType: isAnonymous ? 'anonymous_func' : 'named_func',
        package: pkg.fullName,
        location: { file: spawn.location.file, line: spawn.location.startLine },
      });
    }
  }

  private buildSpawnRelations(rawData: GoRawData): SpawnRelation[] {
    const relations: SpawnRelation[] = [];

    for (const pkg of rawData.packages) {
      // Functions
      for (const func of pkg.functions) {
        if (!func.body) continue;
        const fromId =
          func.name === 'main' && pkg.name === 'main' ? 'main' : `${pkg.fullName}.${func.name}`;

        for (const spawn of func.body.goSpawns) {
          relations.push({
            from: fromId,
            to: `${pkg.fullName}.${func.name}.spawn-${spawn.location.startLine}`,
            spawnType: spawn.call.functionName === '<anonymous>' ? 'go-func' : 'go-stmt',
          });
        }
      }

      // Methods
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (!method.body) continue;
          const fromId = `${pkg.fullName}.${struct.name}.${method.name}`;

          for (const spawn of method.body.goSpawns) {
            relations.push({
              from: fromId,
              to: `${pkg.fullName}.${struct.name}.${method.name}.spawn-${spawn.location.startLine}`,
              spawnType: spawn.call.functionName === '<anonymous>' ? 'go-func' : 'go-stmt',
            });
          }
        }
      }
    }

    return relations;
  }

  private extractChannelInfo(rawData: GoRawData): ChannelInfo[] {
    const channels: ChannelInfo[] = [];

    const scanBody = (
      body: NonNullable<(typeof rawData.packages)[0]['functions'][0]['body']>,
      pkg: GoRawPackage
    ) => {
      for (const op of body.channelOps) {
        if (op.operation === 'make') {
          channels.push({
            id: `chan-${pkg.fullName}-${op.location.startLine}`,
            type: 'chan',
            direction: 'bidirectional',
            location: { file: op.location.file, line: op.location.startLine },
          });
        }
      }
    };

    for (const pkg of rawData.packages) {
      for (const func of pkg.functions) {
        if (func.body) scanBody(func.body, pkg);
      }
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.body) scanBody(method.body, pkg);
        }
      }
    }

    return channels;
  }

  private classifyPattern(
    _node: GoroutineNode,
    _edges: SpawnRelation[],
    _channels: ChannelInfo[]
  ): GoroutinePattern | undefined {
    // TODO: Implement pattern detection (worker-pool, pipeline, fan-out, etc.)
    return undefined;
  }
}
