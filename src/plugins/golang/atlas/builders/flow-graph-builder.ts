import type { GoRawData, GoRawPackage, GoCallExpr, GoField } from '../../types.js';
import type { FlowGraph, EntryPoint, CallChain, CallEdge } from '../types.js';
import type { FlowBuildOptions } from '../types.js';
import type { IAtlasBuilder } from './i-atlas-builder.js';
import type { HttpMethod } from '@/types/extensions/go-atlas.js';

// Internal call pattern — not user-facing
interface CallPattern {
  method?: string; // exact functionName match
  methodSuffix?: string; // suffix match: call.functionName.endsWith(methodSuffix)
  receiverContains?: string; // substring of GoCallExpr.receiverType for disambiguation
  protocol: string;
  httpMethod?: HttpMethod;
  handlerArgIndex?: number; // index into call.args for handler extraction; defaults to 1
}

// Framework pattern table (keyed by DetectedFrameworks key)
const FRAMEWORK_PATTERNS: Record<string, CallPattern[]> = {
  'net/http': [
    { method: 'HandleFunc', protocol: 'http' },
    { method: 'Handle', protocol: 'http' },
  ],
  gin: [
    { method: 'GET', protocol: 'http', httpMethod: 'GET' },
    { method: 'POST', protocol: 'http', httpMethod: 'POST' },
    { method: 'PUT', protocol: 'http', httpMethod: 'PUT' },
    { method: 'DELETE', protocol: 'http', httpMethod: 'DELETE' },
    { method: 'PATCH', protocol: 'http', httpMethod: 'PATCH' },
    { method: 'Any', protocol: 'http', httpMethod: 'ANY' },
  ],
  'gorilla/mux': [
    { method: 'Handle', receiverContains: 'mux.Router', protocol: 'http' },
    { method: 'HandleFunc', receiverContains: 'mux.Router', protocol: 'http' },
  ],
  echo: [
    { method: 'GET', protocol: 'http', httpMethod: 'GET' },
    { method: 'POST', protocol: 'http', httpMethod: 'POST' },
    { method: 'PUT', protocol: 'http', httpMethod: 'PUT' },
    { method: 'DELETE', protocol: 'http', httpMethod: 'DELETE' },
    { method: 'PATCH', protocol: 'http', httpMethod: 'PATCH' },
  ],
  chi: [
    { method: 'Get', protocol: 'http', httpMethod: 'GET' },
    { method: 'Post', protocol: 'http', httpMethod: 'POST' },
    { method: 'Put', protocol: 'http', httpMethod: 'PUT' },
    { method: 'Delete', protocol: 'http', httpMethod: 'DELETE' },
    { method: 'Patch', protocol: 'http', httpMethod: 'PATCH' },
  ],
  cobra: [{ method: 'AddCommand', protocol: 'cli' }],
  grpc: [{ methodSuffix: 'Server', protocol: 'grpc' }],
  'kafka-go': [{ method: 'ConsumePartition', protocol: 'message' }],
  sarama: [{ method: 'ConsumePartition', protocol: 'message' }],
  nats: [
    { method: 'Subscribe', protocol: 'message' },
    { method: 'QueueSubscribe', protocol: 'message' },
  ],
  cron: [
    { method: 'AddFunc', protocol: 'scheduler' },
    { method: 'AddJob', protocol: 'scheduler' },
  ],
  'mcp-go': [
    { method: 'AddTool', protocol: 'mcp', handlerArgIndex: 1 },
    { method: 'RegisterTool', protocol: 'mcp', handlerArgIndex: 1 },
  ],
  'mcp-gosdk': [
    // package-level function: mcp.AddTool(server, tool, handler) — handler at args[2]
    // receiverContains omitted (falsy) so receiver check is skipped for package-level calls
    { method: 'AddTool', protocol: 'mcp', handlerArgIndex: 2 },
  ],
};

function matchesPattern(call: GoCallExpr, p: CallPattern): boolean {
  // method: exact match
  if (p.method && call.functionName !== p.method) return false;
  // methodSuffix: suffix match (for gRPC Register*Server)
  if (p.methodSuffix && !call.functionName.endsWith(p.methodSuffix)) return false;
  // receiverContains: substring of receiverType (skip check if receiverType is absent)
  if (p.receiverContains && call.receiverType) {
    if (!call.receiverType.includes(p.receiverContains)) return false;
  }
  return true;
}

export class FlowGraphBuilder implements IAtlasBuilder<FlowGraph> {
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

  /** Build the set of all interface names across all packages */
  private static buildInterfaceNameSet(rawData: GoRawData): Set<string> {
    const names = new Set<string>();
    for (const pkg of rawData.packages) {
      for (const iface of pkg.interfaces || []) {
        names.add(iface.name);
      }
    }
    return names;
  }

  /** Build varName→declaredType map from a list of GoField (fields or parameters) */
  private static buildContextTypes(fields: GoField[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const field of fields) {
      if (field.name) {
        map.set(field.name, field.type);
      }
    }
    return map;
  }

  /** Classify a single call as 'direct' or 'interface' */
  private static classifyCallType(
    call: GoCallExpr,
    contextTypes: Map<string, string>,
    interfaceNames: Set<string>
  ): 'direct' | 'interface' {
    if (!call.packageName) return 'direct';

    // Extract receiver variable: last segment of packageName split by '.'
    // e.g. "s.store" → "store", "svc" → "svc"
    const segments = call.packageName.split('.');
    const receiverVar = segments[segments.length - 1];

    const declaredType = contextTypes.get(receiverVar);
    if (!declaredType) return 'direct';

    // Strip pointer prefix: "*Store" → "Store"
    const stripped = declaredType.startsWith('*') ? declaredType.slice(1) : declaredType;

    // For qualified types "pkg.Store", also check the short name "Store"
    const shortName = stripped.includes('.') ? stripped.split('.').at(-1) : stripped;

    if (interfaceNames.has(stripped) || interfaceNames.has(shortName)) {
      return 'interface';
    }

    return 'direct';
  }

  private static isNoisyCall(call: CallEdge): boolean {
    const to = call.to;
    if (FlowGraphBuilder.BUILTINS.has(to)) return true;
    const dotIdx = to.indexOf('.');
    if (dotIdx > 0) {
      const pkg = to.slice(0, dotIdx);
      if (FlowGraphBuilder.STDLIB_PREFIXES.has(pkg)) return true;
    }
    if (to.startsWith('w.')) return true;
    if (/^r\.(URL|Context|Body|Header|PathValue|Method|Form)/.test(to)) return true;
    if (to.startsWith('ctx.')) return true;
    if (to.startsWith('err.')) return true;
    return false;
  }

  build(
    rawData: GoRawData,
    options: FlowBuildOptions = { detectedFrameworks: new Set(['net/http']) }
  ): Promise<FlowGraph> {
    const entryPoints = this.detectEntryPoints(rawData, options);
    const callChains = this.buildCallChains(rawData, entryPoints);

    const graph: FlowGraph = { entryPoints, callChains };

    // Protocol filter — applied after all detection
    if (options.protocols && options.protocols.length > 0) {
      const allowed = new Set(options.protocols);
      graph.entryPoints = graph.entryPoints.filter((e) => allowed.has(e.protocol));
      const kept = new Set(graph.entryPoints.map((e) => e.id));
      graph.callChains = graph.callChains.filter((c) => kept.has(c.entryPoint));
    }

    return Promise.resolve(graph);
  }

  private detectEntryPoints(rawData: GoRawData, options: FlowBuildOptions): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];
    const {
      detectedFrameworks,
      customFrameworks = [],
      entryPoints: manualEntryPoints = [],
      entryPointPattern,
    } = options;

    // Collect active patterns from detected frameworks
    const activePatterns: Array<{ frameworkKey: string; pattern: CallPattern }> = [];
    for (const key of detectedFrameworks) {
      const patterns = FRAMEWORK_PATTERNS[key];
      if (patterns) {
        for (const p of patterns) {
          activePatterns.push({ frameworkKey: key, pattern: p });
        }
      }
    }

    // Add custom framework patterns
    for (const cf of customFrameworks) {
      for (const cp of cf.patterns) {
        const pattern: CallPattern = {
          method: cp.method,
          methodSuffix: cp.methodSuffix,
          receiverContains: cp.receiverContains,
          protocol: cf.protocol,
          handlerArgIndex: cp.handlerArgIndex,
        };
        activePatterns.push({ frameworkKey: cf.name, pattern });
      }
    }

    for (const pkg of rawData.packages) {
      // Scan function bodies
      for (const func of pkg.functions) {
        if (!func.body) continue;
        for (const call of func.body.calls) {
          const entry = this.matchCallPattern(call, pkg, activePatterns);
          if (entry) entryPoints.push(entry);
        }
      }

      // Scan method bodies
      for (const struct of pkg.structs || []) {
        for (const method of struct.methods || []) {
          if (!method.body) continue;
          for (const call of method.body.calls) {
            const entry = this.matchCallPattern(call, pkg, activePatterns);
            if (entry) entryPoints.push(entry);
          }
        }
      }

      // main() injection — separate scan, not via call expressions
      if (pkg.name === 'main' && detectedFrameworks.has('main')) {
        for (const func of pkg.functions) {
          if (func.name === 'main') {
            entryPoints.push({
              id: `entry-${pkg.fullName}-main`,
              protocol: 'cli',
              framework: 'main',
              path: '',
              handler: 'main.main',
              middleware: [],
              package: pkg.fullName,
              location: { file: func.location.file, line: func.location.startLine },
            });
          }
        }
      }
    }

    // Secondary fallback: only fires when primary detection found no entry points
    if (entryPoints.length === 0) {
      const fallbackEntries = this.detectGenericToolRegistrations(rawData);
      entryPoints.push(...fallbackEntries);
    }

    // Manual entry points injection
    for (const manual of manualEntryPoints) {
      entryPoints.push({
        id: `entry-manual-${manual.function.replace(/[^a-zA-Z0-9]/g, '_')}`,
        protocol: manual.protocol,
        framework: 'manual',
        path: '',
        handler: manual.function,
        middleware: [],
        location: { file: 'manual', line: 0 },
      });
    }

    // entryPointPattern: regex scan across all calls (independent of primary detection)
    if (entryPointPattern) {
      let regex: RegExp;
      try {
        regex = new RegExp(entryPointPattern);
      } catch {
        regex = /(?!)/; // invalid regex → never-match
      }
      const scanCalls = (pkg: GoRawPackage, calls: GoCallExpr[]) => {
        for (const call of calls) {
          if (regex.test(call.functionName)) {
            const rawHandler = call.args?.[1] ?? '';
            const handler = rawHandler.startsWith('func(') ? '' : rawHandler;
            entryPoints.push({
              id: `entry-pattern-${pkg.fullName}-${call.location.startLine}`,
              protocol: 'custom',
              framework: 'entry-pattern',
              path: call.args?.[0] ?? '',
              handler,
              middleware: [],
              package: pkg.fullName,
              location: { file: call.location.file, line: call.location.startLine },
            });
          }
        }
      };
      for (const pkg of rawData.packages) {
        for (const func of pkg.functions) {
          if (func.body) scanCalls(pkg, func.body.calls);
        }
        for (const struct of pkg.structs || []) {
          for (const m of struct.methods || []) {
            if (m.body) scanCalls(pkg, m.body.calls);
          }
        }
      }
    }

    return entryPoints;
  }

  private detectGenericToolRegistrations(rawData: GoRawData): EntryPoint[] {
    const GENERIC_SUFFIXES = ['AddTool', 'RegisterTool', 'AddCommand', 'HandleFunc'];
    const found: EntryPoint[] = [];
    const scan = (pkg: GoRawPackage, calls: GoCallExpr[]) => {
      for (const call of calls) {
        const name = call.functionName;
        if (GENERIC_SUFFIXES.some((s) => name === s || name.endsWith(s))) {
          const rawHandler = call.args?.[1] ?? '';
          const handler = rawHandler.startsWith('func(') ? '' : rawHandler;
          found.push({
            id: `entry-generic-${pkg.fullName}-${call.location.startLine}`,
            protocol: 'custom',
            framework: 'generic-heuristic',
            path: call.args?.[0] ?? '',
            handler,
            middleware: [],
            package: pkg.fullName,
            location: { file: call.location.file, line: call.location.startLine },
          });
        }
      }
    };
    for (const pkg of rawData.packages) {
      for (const func of pkg.functions) {
        if (func.body) scan(pkg, func.body.calls);
      }
      for (const struct of pkg.structs || []) {
        for (const method of struct.methods || []) {
          if (method.body) scan(pkg, method.body.calls);
        }
      }
    }
    return found;
  }

  private matchCallPattern(
    call: GoCallExpr,
    pkg: GoRawPackage,
    activePatterns: Array<{ frameworkKey: string; pattern: CallPattern }>
  ): EntryPoint | null {
    const path = call.args?.[0] ?? '';

    for (const { frameworkKey, pattern } of activePatterns) {
      if (matchesPattern(call, pattern)) {
        const handlerArgIdx = pattern.handlerArgIndex ?? 1;
        const rawHandler = call.args?.[handlerArgIdx] ?? '';
        const handler = rawHandler.startsWith('func(') ? '' : rawHandler;
        return {
          id: `entry-${pkg.fullName}-${call.location.startLine}`,
          protocol: pattern.protocol,
          method: pattern.httpMethod,
          framework: frameworkKey,
          path,
          handler,
          middleware: [],
          package: pkg.fullName,
          location: { file: call.location.file, line: call.location.startLine },
        };
      }
    }

    return null;
  }

  private buildCallChains(rawData: GoRawData, entryPoints: EntryPoint[]): CallChain[] {
    const interfaceNames = FlowGraphBuilder.buildInterfaceNameSet(rawData);
    const chains: CallChain[] = [];
    for (const entry of entryPoints) {
      const calls = this.traceCallsFromEntry(rawData, entry, interfaceNames);
      chains.push({
        id: `chain-${entry.id}`,
        entryPoint: entry.id,
        calls,
      });
    }
    return chains;
  }

  private traceCallsFromEntry(
    rawData: GoRawData,
    entry: EntryPoint,
    interfaceNames: Set<string>
  ): CallEdge[] {
    const calls: CallEdge[] = [];
    if (!entry.handler) return calls;

    const handlerFnName = entry.handler.split('.').at(-1) ?? entry.handler;

    for (const pkg of rawData.packages) {
      for (const func of pkg.functions) {
        if (func.name !== handlerFnName || !func.body) continue;
        const contextTypes = FlowGraphBuilder.buildContextTypes(func.parameters);
        for (const call of func.body.calls) {
          const callType = FlowGraphBuilder.classifyCallType(call, contextTypes, interfaceNames);
          calls.push({
            from: entry.handler,
            to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
            type: callType,
            confidence: callType === 'interface' ? 0.8 : 0.7,
          });
        }
      }
      for (const struct of pkg.structs || []) {
        const method = (struct.methods || []).find((m) => m.name === handlerFnName);
        if (!method || !method.body) continue;
        const contextTypes = new Map([
          ...FlowGraphBuilder.buildContextTypes(struct.fields),
          ...FlowGraphBuilder.buildContextTypes(method.parameters),
        ]);
        for (const call of method.body.calls) {
          const callType = FlowGraphBuilder.classifyCallType(call, contextTypes, interfaceNames);
          calls.push({
            from: entry.handler,
            to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
            type: callType,
            confidence: callType === 'interface' ? 0.8 : 0.7,
          });
        }
      }
    }

    const seen = new Set<string>();
    return calls
      .filter((call) => {
        const key = `${call.from}\x00${call.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter((call) => !FlowGraphBuilder.isNoisyCall(call));
  }
}
