import type { GoRawData, GoRawPackage, GoSpawnStmt, GoFunctionBody, GoField } from '../../types.js';
import type {
  GoroutineTopology,
  GoroutineNode,
  GoroutinePattern,
  GoroutineLifecycleSummary,
  SpawnRelation,
  ChannelInfo,
  ChannelEdge,
} from '../types.js';
import type { IAtlasBuilder } from './i-atlas-builder.js';

/**
 * Goroutine topology builder
 *
 * Scans both functions AND methods for go spawn statements.
 * Output types from ADR-002 v1.2 (includes spawnType on GoroutineNode).
 */
export class GoroutineTopologyBuilder implements IAtlasBuilder<GoroutineTopology> {
  build(rawData: GoRawData): Promise<GoroutineTopology> {
    const nodes = this.extractGoroutineNodes(rawData);
    const edges = this.buildSpawnRelations(rawData);
    const channels = this.extractChannelInfo(rawData);
    const channelEdges = this.buildChannelEdges(rawData);

    // Classify patterns
    for (const node of nodes) {
      node.pattern = this.classifyPattern(node, edges, channels);
    }

    const lifecycle = this.buildLifecycle(rawData);

    return Promise.resolve({
      nodes,
      edges,
      channels,
      channelEdges,
      lifecycle: lifecycle.length > 0 ? lifecycle : undefined,
    });
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
            id: `${pkg.fullName}.main`,
            name: `${pkg.fullName}.main`,
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
        const fromId = `${pkg.fullName}.${func.name}`;

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
            name: op.channelName,
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

  private buildChannelEdges(rawData: GoRawData): ChannelEdge[] {
    const channelEdges: ChannelEdge[] = [];

    for (const pkg of rawData.packages) {
      // Standalone functions
      for (const func of pkg.functions) {
        if (!func.body) continue;
        const spawnerId = `${pkg.fullName}.${func.name}`;
        this.extractBodyChannelEdges(func.body, pkg, spawnerId, func.name, channelEdges);
      }

      // Struct methods
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (!method.body) continue;
          const spawnerId = `${pkg.fullName}.${struct.name}.${method.name}`;
          const parentName = `${struct.name}.${method.name}`;
          this.extractBodyChannelEdges(method.body, pkg, spawnerId, parentName, channelEdges);
        }
      }
    }

    return channelEdges;
  }

  private extractBodyChannelEdges(
    body: GoFunctionBody,
    pkg: GoRawPackage,
    spawnerId: string,
    parentName: string,
    channelEdges: ChannelEdge[]
  ): void {
    // Build local scope: channelVarName → channelId from make ops in this body
    const scopeMap = new Map<string, string>();
    for (const op of body.channelOps) {
      if (op.operation === 'make' && op.channelName) {
        const channelId = `chan-${pkg.fullName}-${op.location.startLine}`;
        scopeMap.set(op.channelName, channelId);
        // Emit make edge: spawner → channel
        channelEdges.push({ from: spawnerId, to: channelId, edgeType: 'make' });
      }
    }

    // For each spawn: check if any arg matches a channel var in scope
    for (const spawn of body.goSpawns) {
      const args = spawn.call.args ?? [];
      for (const arg of args) {
        const channelId = scopeMap.get(arg);
        if (channelId !== undefined) {
          const spawnedId = `${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}`;
          channelEdges.push({ from: channelId, to: spawnedId, edgeType: 'recv' });
          break; // one recv edge per spawn (first matching arg)
        }
      }
    }
  }

  /**
   * Build per-goroutine lifecycle summaries (Phase C-1).
   *
   * For each spawned goroutine, classifies cancellation hygiene using a two-tier approach:
   * - Tier 1: context.Context parameter check (always available from parameter list)
   * - Tier 2: body-level cancellation check (ctx.Done() or stop-channel receive)
   *
   * When function body was not extracted (selective mode), cancellationCheckAvailable=false.
   */
  private buildLifecycle(rawData: GoRawData): GoroutineLifecycleSummary[] {
    const summaries: GoroutineLifecycleSummary[] = [];

    // Channel names that indicate stop-channel cancellation patterns
    const STOP_CHANNEL_NAMES = new Set(['done', 'stop', 'quit', 'cancel', 'stopCh', 'doneCh']);

    for (const pkg of rawData.packages) {
      // Build a lookup from function/method name → { params, body }
      // Covers standalone functions only (methods are not spawn targets by name alone)
      const funcByName = new Map<string, { params: GoField[]; body: GoFunctionBody | undefined }>();

      for (const func of pkg.functions) {
        funcByName.set(func.name, { params: func.parameters ?? [], body: func.body });
      }

      // Collect all spawn statements with their parent names
      // Follows the same iteration pattern as extractGoroutineNodes / buildSpawnRelations
      const allSpawns: Array<{ spawn: GoSpawnStmt; parentName: string }> = [];

      for (const func of pkg.functions) {
        if (func.body) {
          for (const spawn of func.body.goSpawns) {
            allSpawns.push({ spawn, parentName: func.name });
          }
        }
      }

      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.body) {
            for (const spawn of method.body.goSpawns) {
              allSpawns.push({ spawn, parentName: `${struct.name}.${method.name}` });
            }
          }
        }
      }

      for (const { spawn, parentName } of allSpawns) {
        const nodeId = `${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}`;
        const targetName = spawn.call.functionName;
        const isAnonymous = targetName === '<anonymous>';

        if (isAnonymous) {
          summaries.push({
            nodeId,
            spawnTargetName: '<anonymous>',
            receivesContext: false,
            cancellationCheckAvailable: false,
            orphan: true,
          });
          continue;
        }

        // Look up the target function in this package
        const targetFunc = funcByName.get(targetName);

        if (!targetFunc) {
          // Cross-package target or not found → cannot determine lifecycle
          summaries.push({
            nodeId,
            spawnTargetName: targetName,
            receivesContext: false,
            cancellationCheckAvailable: false,
            orphan: true,
          });
          continue;
        }

        // Tier 1: Does the target function accept a context.Context parameter?
        const ctxParam = targetFunc.params.find((p) => p.type?.includes('context.Context'));
        const receivesContext = ctxParam !== undefined;
        const ctxVarName = ctxParam?.name;

        if (!targetFunc.body) {
          // Body not extracted (selective mode) → Tier 2 unavailable
          summaries.push({
            nodeId,
            spawnTargetName: targetName,
            receivesContext,
            cancellationCheckAvailable: false,
            orphan: !receivesContext,
          });
          continue;
        }

        // Tier 2: Check body for cancellation signals
        const body = targetFunc.body;

        // ctx.Done() call: a call to functionName 'Done' where packageName matches the ctx var name
        const hasCtxDone =
          receivesContext &&
          ctxVarName != null &&
          (body.calls ?? []).some((c) => c.functionName === 'Done' && c.packageName === ctxVarName);

        // Stop-channel receive: a receive op on a well-known stop-channel variable name
        const hasStopChannel = (body.channelOps ?? []).some(
          (op) => op.operation === 'receive' && STOP_CHANNEL_NAMES.has(op.channelName)
        );

        const hasCancellationCheck = hasCtxDone || hasStopChannel;
        const cancellationMechanism: 'context' | 'channel' | undefined = hasCtxDone
          ? 'context'
          : hasStopChannel
            ? 'channel'
            : undefined;

        // A goroutine is orphaned when it neither receives a context nor has any
        // cancellation check (it cannot be stopped by the caller)
        const orphan = !receivesContext && !hasCancellationCheck;

        summaries.push({
          nodeId,
          spawnTargetName: targetName,
          receivesContext,
          cancellationCheckAvailable: true,
          hasCancellationCheck,
          ...(cancellationMechanism !== undefined ? { cancellationMechanism } : {}),
          orphan,
        });
      }
    }

    return summaries;
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
