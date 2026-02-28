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
  private static readonly STDLIB_PREFIXES = new Set([
    'fmt',
    'json',
    'strconv',
    'time',
    'errors',
    'strings',
    'sort',
    'sync',
    'io',
    'bytes',
    'math',
    'os',
    'log',
    'context',
    'net',
    'http',
    'reflect',
    'unicode',
    'filepath',
    'path',
    'regexp',
    'bufio',
    'runtime',
  ]);

  private static readonly BUILTINS = new Set([
    'make',
    'len',
    'append',
    'cap',
    'new',
    'delete',
    'copy',
    'close',
    'panic',
    'recover',
    'print',
    'println',
    'int',
    'int8',
    'int16',
    'int32',
    'int64',
    'uint',
    'uint8',
    'uint16',
    'uint32',
    'uint64',
    'string',
    'bool',
    'float32',
    'float64',
    'byte',
    'rune',
    'error',
  ]);

  /**
   * Returns true when the call edge represents stdlib / HTTP-primitive / builtin
   * noise that should be excluded from business-logic flow graphs.
   */
  private static isNoisyCall(call: CallEdge): boolean {
    const to = call.to;

    // Go builtins and primitive type conversions
    if (FlowGraphBuilder.BUILTINS.has(to)) return true;

    // stdlib package prefix (e.g. "fmt.Sprintf", "json.NewDecoder")
    const dotIdx = to.indexOf('.');
    if (dotIdx > 0) {
      const pkg = to.slice(0, dotIdx);
      if (FlowGraphBuilder.STDLIB_PREFIXES.has(pkg)) return true;
    }

    // HTTP primitives: w.* (ResponseWriter methods)
    if (to.startsWith('w.')) return true;

    // HTTP Request field accesses
    if (/^r\.(URL|Context|Body|Header|PathValue|Method|Form)/.test(to)) return true;

    // Context and error primitives
    if (to.startsWith('ctx.')) return true;
    if (to.startsWith('err.')) return true;

    return false;
  }
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
        package: pkg.fullName,
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
        package: pkg.fullName,
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

    // Deduplicate by (from, to) — keep first occurrence
    const seen = new Set<string>();
    return (
      calls
        .filter((call) => {
          const key = `${call.from}\x00${call.to}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        // Filter stdlib / HTTP-primitive / builtin noise — keep only business logic calls
        .filter((call) => !FlowGraphBuilder.isNoisyCall(call))
    );
  }
}
