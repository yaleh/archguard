import path from 'path';
import type {
  PackageGraph,
  PackageNode,
  CapabilityNode,
  GoroutineLifecycleSummary,
  EntryPoint,
} from '../types.js';

export interface GroupNode {
  prefix: string;
  children: GroupNode[];
  nodeIds: string[];
}

export interface PkgTreeNode {
  pkg: string;
  isVirtual: boolean;
  children: PkgTreeNode[];
}

export const SUBGRAPH_DEPTH_STYLES = [
  'fill:#ffffff,stroke:#d0d7de,stroke-width:1px',
  'fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px',
  'fill:#eaeef2,stroke:#8b949e,stroke-width:1px',
  'fill:#d0d7de,stroke:#57606a,stroke-width:1px',
] as const;

export const FLOWCHART_INIT =
  "%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%\n";
export const SEQUENCE_INIT = "%%{init: {'sequence': {'actorMargin': 50}}}%%\n";

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function createSubgraphId(rawId: string, usedIds: Set<string>): string {
  const base = `grp_${sanitizeId(rawId)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  usedIds.add(candidate);
  return candidate;
}

export function buildPackageTree(packages: string[]): PkgTreeNode[] {
  const pkgSet = new Set(packages);
  const prefixCount = new Map<string, number>();

  for (const pkg of packages) {
    const segs = pkg.split('/');
    for (let d = 1; d < segs.length; d++) {
      const prefix = segs.slice(0, d).join('/');
      prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
    }
  }

  const virtualGroups = new Set<string>();
  for (const [prefix, count] of prefixCount) {
    if (count >= 2 && !pkgSet.has(prefix)) {
      virtualGroups.add(prefix);
    }
  }

  const allPrefixes = new Set([...packages, ...virtualGroups]);
  const nodeMap = new Map<string, PkgTreeNode>();
  for (const prefix of allPrefixes) {
    nodeMap.set(prefix, { pkg: prefix, isVirtual: !pkgSet.has(prefix), children: [] });
  }

  const parentOf = (pkg: string): string | null => {
    const segs = pkg.split('/');
    for (let d = segs.length - 1; d >= 1; d--) {
      const prefix = segs.slice(0, d).join('/');
      if (allPrefixes.has(prefix)) return prefix;
    }
    return null;
  };

  const roots: PkgTreeNode[] = [];
  for (const prefix of allPrefixes) {
    const parent = parentOf(prefix);
    if (parent && nodeMap.has(parent)) {
      nodeMap.get(parent)!.children.push(nodeMap.get(prefix)!);
    } else {
      roots.push(nodeMap.get(prefix)!);
    }
  }

  return roots;
}

export function buildGroupTree(nodes: Array<{ id: string; name: string }>): {
  roots: GroupNode[];
  grouped: Set<string>;
} {
  const prefixMembers = new Map<string, string[]>();
  for (const node of nodes) {
    const segs = node.name.split('/');
    for (let d = 1; d <= segs.length; d++) {
      const prefix = segs.slice(0, d).join('/');
      const arr = prefixMembers.get(prefix) ?? [];
      arr.push(node.id);
      prefixMembers.set(prefix, arr);
    }
  }

  const validPrefixes = new Set<string>();
  for (const [prefix, ids] of prefixMembers) {
    if (ids.length >= 2) validPrefixes.add(prefix);
  }

  const deepestGroupFor = (name: string): string | null => {
    const segs = name.split('/');
    for (let d = segs.length; d >= 1; d--) {
      const prefix = segs.slice(0, d).join('/');
      if (validPrefixes.has(prefix)) return prefix;
    }
    return null;
  };

  const parentGroupFor = (prefix: string): string | null => {
    const segs = prefix.split('/');
    for (let d = segs.length - 1; d >= 1; d--) {
      const parent = segs.slice(0, d).join('/');
      if (validPrefixes.has(parent)) return parent;
    }
    return null;
  };

  const nodeObjects = new Map<string, GroupNode>();
  for (const prefix of validPrefixes) {
    nodeObjects.set(prefix, { prefix, children: [], nodeIds: [] });
  }

  const roots: GroupNode[] = [];
  for (const prefix of validPrefixes) {
    const parent = parentGroupFor(prefix);
    if (parent && nodeObjects.has(parent)) {
      nodeObjects.get(parent)!.children.push(nodeObjects.get(prefix)!);
    } else {
      roots.push(nodeObjects.get(prefix)!);
    }
  }

  const grouped = new Set<string>();
  for (const node of nodes) {
    const group = deepestGroupFor(node.name);
    if (group && nodeObjects.has(group)) {
      nodeObjects.get(group)!.nodeIds.push(node.id);
      grouped.add(node.id);
    }
  }

  return { roots, grouped };
}

export function renderGroupNodes(
  groups: GroupNode[],
  nodeMap: Map<string, PackageNode>,
  cycleNodeIds: Set<string>,
  indent: string,
  usedIds: Set<string>,
  subgraphDepthMap: Map<string, number>,
  inDegree?: Map<string, number>,
  depth = 0
): string {
  let out = '';
  for (const group of groups) {
    const sgId = createSubgraphId(group.prefix, usedIds);
    subgraphDepthMap.set(sgId, depth);
    out += `\n${indent}subgraph ${sgId}["${group.prefix}"]\n`;
    out += renderGroupNodes(
      group.children,
      nodeMap,
      cycleNodeIds,
      `${indent}  `,
      usedIds,
      subgraphDepthMap,
      inDegree,
      depth + 1
    );

    const sortedIds = inDegree
      ? [...group.nodeIds].sort((a, b) => {
          const diff = (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        })
      : group.nodeIds;

    for (const nodeId of sortedIds) {
      const node = nodeMap.get(nodeId)!;
      const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
      out += `${indent}  ${sanitizeId(node.id)}["${node.name}"]${style}\n`;
    }
    out += `${indent}end\n`;
  }
  return out;
}

export function renderPackageLegend(activeTypes: Set<string>): string {
  const labels: Record<string, string> = {
    cmd: 'cmd (entry point)',
    tests: 'tests',
    examples: 'examples',
    testutil: 'testutil',
    internal: 'internal',
    vendor: 'vendor',
    external: 'external (module boundary)',
    cycle: 'cycle (circular dep)',
  };
  let out = '  subgraph legend["Legend"]\n';
  out += '    direction LR\n';
  for (const type of Object.keys(labels)) {
    if (activeTypes.has(type)) {
      out += `    legend_${type}["${labels[type]}"]:::${type}\n`;
    }
  }
  out += '    legend_edge["--> depends on (bolder = more imports)"]\n';
  out += '  end\n';
  out += '  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01\n\n';
  return out;
}

export function formatCapabilityLabel(node: CapabilityNode): string {
  const sizeParts: string[] = [];
  if ((node.fieldCount ?? 0) > 0) sizeParts.push(`${node.fieldCount}f`);
  if ((node.methodCount ?? 0) > 0) sizeParts.push(`${node.methodCount}m`);

  const couplingParts: string[] = [];
  if ((node.fanIn ?? 0) > 0) couplingParts.push(`fi:${node.fanIn}`);
  if ((node.fanOut ?? 0) > 0) couplingParts.push(`fo:${node.fanOut}`);

  if (sizeParts.length === 0 && couplingParts.length === 0) {
    return node.name;
  }

  const sections: string[] = [];
  if (sizeParts.length > 0) sections.push(sizeParts.join(' '));
  if (couplingParts.length > 0) sections.push(couplingParts.join(' '));
  return `${node.name} [${sections.join(' | ')}]`;
}

export function isHotspot(node: CapabilityNode): boolean {
  return (node.methodCount ?? 0) > 10 || (node.fanIn ?? 0) > 5;
}

export function computePackageEdgeTiers(strengths: number[]): Map<number, number> {
  if (strengths.length === 0) return new Map();
  const sorted = [...strengths].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max === min) return new Map();

  const n = sorted.length;
  let thMedium = sorted[Math.min(Math.floor(n * 0.5), n - 1)];
  let thHeavy = sorted[Math.min(Math.floor(n * 0.85), n - 1)];
  if (thMedium >= max) {
    thMedium = min;
    thHeavy = max;
  }

  const result = new Map<number, number>();
  for (const strength of new Set(strengths)) {
    if (strength >= thHeavy) {
      result.set(strength, 5.0);
    } else if (strength > thMedium) {
      result.set(strength, 3.0);
    }
  }
  return result;
}

export function formatEntryLabel(entry: EntryPoint): string {
  if (entry.protocol === 'http') {
    const method = entry.method ?? 'HTTP';
    return `${method} ${entry.path}`;
  }
  if (entry.protocol === 'grpc') return `gRPC ${entry.path}`;
  if (entry.protocol === 'cli') return `CMD ${entry.path || entry.handler}`;
  if (entry.protocol === 'message') return `MSG ${entry.path}`;
  if (entry.protocol === 'scheduler') return `CRON ${entry.path}`;
  return entry.path || entry.id;
}

export function formatSpawnerLabel(nodeId: string): string {
  const slashIdx = nodeId.lastIndexOf('/');
  const afterSlash = slashIdx >= 0 ? nodeId.slice(slashIdx + 1) : nodeId;
  const parts = afterSlash.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : afterSlash;
}

export function formatChannelLabel(channelId: string): string {
  const withoutPrefix = channelId.startsWith('chan-') ? channelId.slice(5) : channelId;
  const withoutSuffix = withoutPrefix.replace(/-\d+$/, '');
  const slashIdx = withoutSuffix.lastIndexOf('/');
  return slashIdx >= 0 ? withoutSuffix.slice(slashIdx + 1) : withoutSuffix;
}

export function formatGoroutineName(node: { id: string; name: string }): string {
  if (node.name) {
    const slashIdx = node.name.lastIndexOf('/');
    const afterSlash = slashIdx >= 0 ? node.name.slice(slashIdx + 1) : node.name;
    const dotIdx = afterSlash.indexOf('.');
    if (dotIdx > 0 && afterSlash.slice(0, dotIdx).includes('-')) {
      const symbol = afterSlash.slice(dotIdx + 1);
      if (
        symbol.length > 0 &&
        symbol[0] === symbol[0].toUpperCase() &&
        symbol[0] !== symbol[0].toLowerCase()
      ) {
        return symbol;
      }
    }
    return afterSlash;
  }

  const stripped = node.id.replace(/\.spawn-\d+$/, '');
  const afterSlash = stripped.slice(stripped.lastIndexOf('/') + 1);
  const parts = afterSlash.split('.');
  return parts.slice(-2).join('.');
}

export function getLifecycleTag(
  nodeId: string,
  lifecycle: GoroutineLifecycleSummary[] | undefined
): string {
  const entry = lifecycle?.find((item) => item.nodeId === nodeId);
  if (!entry) return '';
  if (entry.receivesContext && entry.hasCancellationCheck) return ' \u2713ctx';
  if (entry.receivesContext && !entry.cancellationCheckAvailable) return ' ctx?';
  if (entry.orphan) return ' \u26a0 no exit';
  return '';
}

export function packageOfEntry(entry: EntryPoint): string {
  return entry.package ?? path.dirname(entry.location.file);
}
