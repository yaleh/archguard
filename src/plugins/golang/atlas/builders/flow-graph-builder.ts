import type { GoRawData, GoRawPackage, GoCallExpr } from '../../types.js';
import type { FlowGraph, EntryPoint, CallChain, CallEdge, EntryPointType } from '../types.js';

/**
 * Flow graph builder (entry points and call chains)
 *
 * Entry point detection uses AST-based pattern matching on call expressions.
 *
 * NOTE: For interface call resolution, gopls is REQUIRED (not optional).
 * Without gopls, Flow Graph accuracy drops to ~30%.
 */
export class FlowGraphBuilder {
  build(rawData: GoRawData): Promise<FlowGraph> {
    const entryPoints = this.detectEntryPoints(rawData);
    const callChains = this.buildCallChains(rawData, entryPoints);

    return Promise.resolve({ entryPoints, callChains });
  }

  /**
   * Detect HTTP entry points via call expression pattern matching
   *
   * Supported patterns:
   * - http.HandleFunc("/path", handler)
   * - mux.Handle("/path", handler)
   * - router.GET/POST/...("/path", handler)
   */
  private detectEntryPoints(rawData: GoRawData): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    for (const pkg of rawData.packages) {
      // Scan function bodies for HTTP handler registration calls
      for (const func of pkg.functions) {
        if (!func.body) continue;

        for (const call of func.body.calls) {
          const entry = this.matchEntryPointPattern(call, pkg);
          if (entry) entryPoints.push(entry);
        }
      }

      // Also scan method bodies
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (!method.body) continue;

          for (const call of method.body.calls) {
            const entry = this.matchEntryPointPattern(call, pkg);
            if (entry) entryPoints.push(entry);
          }
        }
      }
    }

    return entryPoints;
  }

  /**
   * Match call expression against known HTTP framework patterns
   */
  private matchEntryPointPattern(call: GoCallExpr, pkg: GoRawPackage): EntryPoint | null {
    const path = call.args?.[0] ?? '';
    const rawHandler = call.args?.[1] ?? '';
    const handler = rawHandler.startsWith('func(') ? '' : rawHandler;

    // http.HandleFunc or mux.HandleFunc / mux.Handle
    if (call.functionName === 'HandleFunc' || call.functionName === 'Handle') {
      return {
        id: `entry-${pkg.fullName}-${call.location.startLine}`,
        type: 'http-handler' as EntryPointType,
        path,
        handler,
        middleware: [],
        location: { file: call.location.file, line: call.location.startLine },
      };
    }

    // gin/echo: router.GET, router.POST, etc.
    const httpMethodMap: Record<string, EntryPointType> = {
      GET: 'http-get',
      POST: 'http-post',
      PUT: 'http-put',
      DELETE: 'http-delete',
      PATCH: 'http-patch',
    };

    if (call.functionName in httpMethodMap) {
      return {
        id: `entry-${pkg.fullName}-${call.location.startLine}`,
        type: httpMethodMap[call.functionName],
        path,
        handler,
        middleware: [],
        location: { file: call.location.file, line: call.location.startLine },
      };
    }

    return null;
  }

  private buildCallChains(rawData: GoRawData, entryPoints: EntryPoint[]): CallChain[] {
    const chains: CallChain[] = [];

    for (const entry of entryPoints) {
      const calls = this.traceCallsFromEntry(rawData, entry);
      chains.push({
        id: `chain-${entry.id}`,
        entryPoint: entry.id,
        calls,
      });
    }

    return chains;
  }

  private traceCallsFromEntry(rawData: GoRawData, entry: EntryPoint): CallEdge[] {
    // Basic implementation: collect direct calls from handler function
    // Full implementation requires gopls for interface resolution
    const calls: CallEdge[] = [];

    if (!entry.handler) return calls;

    // handler may be a selector expression like "s.handleSessions"; match on the final segment
    const handlerFnName = entry.handler.split('.').at(-1) ?? entry.handler;

    for (const pkg of rawData.packages) {
      // Search top-level functions
      for (const func of pkg.functions) {
        if (func.name !== handlerFnName || !func.body) continue;

        for (const call of func.body.calls) {
          calls.push({
            from: entry.handler,
            to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
            type: 'direct',
            confidence: 0.7,
          });
        }
      }

      // Also search struct methods
      for (const struct of pkg.structs || []) {
        const method = (struct.methods || []).find((m) => m.name === handlerFnName);
        if (!method || !method.body) continue;

        for (const call of method.body.calls) {
          calls.push({
            from: entry.handler,
            to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
            type: 'direct',
            confidence: 0.7,
          });
        }
      }
    }

    return calls;
  }
}
