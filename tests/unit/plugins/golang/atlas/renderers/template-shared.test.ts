/**
 * Unit tests for atlas renderers template-shared helpers.
 */

import { describe, it, expect } from 'vitest';
import type { CapabilityNode } from '@/plugins/golang/atlas/types.js';
import {
  sanitizeId,
  createSubgraphId,
  buildPackageTree,
  buildGroupTree,
  renderPackageLegend,
  formatCapabilityLabel,
  isHotspot,
  computePackageEdgeTiers,
  formatEntryLabel,
  formatSpawnerLabel,
  formatChannelLabel,
  formatGoroutineName,
  getLifecycleTag,
  packageOfEntry,
} from '@/plugins/golang/atlas/renderers/template-shared.js';
import type { EntryPoint } from '@/types/extensions/go-atlas.js';

describe('sanitizeId', () => {
  it('replaces non-alphanumeric chars with underscores', () => {
    expect(sanitizeId('pkg/foo-bar')).toBe('pkg_foo_bar');
    expect(sanitizeId('plain')).toBe('plain');
  });
});

describe('createSubgraphId', () => {
  it('creates a base id when unused', () => {
    const used = new Set<string>();
    expect(createSubgraphId('pkg/a', used)).toBe('grp_pkg_a');
    expect(used.has('grp_pkg_a')).toBe(true);
  });
  it('increments the suffix on collision', () => {
    const used = new Set(['grp_pkg_a']);
    expect(createSubgraphId('pkg/a', used)).toBe('grp_pkg_a_2');
    used.add('grp_pkg_a_2');
    expect(createSubgraphId('pkg/a', used)).toBe('grp_pkg_a_3');
  });
});

describe('buildPackageTree', () => {
  it('builds a tree with virtual grouping nodes', () => {
    const roots = buildPackageTree(['github.com/x/a', 'github.com/x/b', 'github.com/y/c']);
    // github.com is a shared prefix → virtual group
    const github = roots.find((r) => r.pkg === 'github.com');
    expect(github?.isVirtual).toBe(true);
    const x = github?.children.find((c) => c.pkg === 'github.com/x');
    expect(x?.children).toHaveLength(2);
    // github.com/y/c is alone under github.com/y (count 1 → not virtual group itself, but nested)
    expect(x).toBeDefined();
  });
});

describe('buildGroupTree', () => {
  it('groups nodes by shared prefixes and marks grouped ids', () => {
    const nodes = [
      { id: 'a', name: 'svc/auth/login' },
      { id: 'b', name: 'svc/auth/register' },
      { id: 'c', name: 'svc/billing' },
    ];
    const { roots, grouped } = buildGroupTree(nodes);
    expect(grouped.has('a')).toBe(true);
    expect(grouped.has('b')).toBe(true);
    // svc has 3 members → svc is a valid group, so c is also grouped at the svc level
    expect(grouped.has('c')).toBe(true);
    expect(roots.length).toBeGreaterThan(0);
  });
});

describe('renderPackageLegend', () => {
  it('renders legend entries for active types only', () => {
    const out = renderPackageLegend(new Set(['internal', 'cycle']));
    expect(out).toContain('legend_internal');
    expect(out).toContain('legend_cycle');
    expect(out).not.toContain('legend_vendor');
    expect(out).toContain('legend_edge');
  });
});

describe('formatCapabilityLabel', () => {
  const node = (overrides: Partial<CapabilityNode> = {}): CapabilityNode =>
    ({
      id: 'n',
      name: 'Svc',
      type: 'interface',
      package: 'p',
      exported: true,
      ...overrides,
    }) as CapabilityNode;
  it('returns the bare name when no metrics', () => {
    expect(formatCapabilityLabel(node())).toBe('Svc');
  });
  it('includes field/method counts and fan metrics', () => {
    expect(formatCapabilityLabel(node({ fieldCount: 2, methodCount: 3 }))).toBe('Svc [2f 3m]');
    expect(formatCapabilityLabel(node({ fanIn: 4, fanOut: 1 }))).toBe('Svc [fi:4 fo:1]');
    expect(formatCapabilityLabel(node({ methodCount: 1, fanIn: 2 }))).toBe('Svc [1m | fi:2]');
  });
});

describe('isHotspot', () => {
  const node = (overrides: Partial<CapabilityNode> = {}) =>
    ({
      id: 'n',
      name: 'Svc',
      type: 'interface',
      package: 'p',
      exported: true,
      ...overrides,
    }) as CapabilityNode;
  it('flags nodes with >10 methods or >5 fan-in', () => {
    expect(isHotspot(node({ methodCount: 11 }))).toBe(true);
    expect(isHotspot(node({ fanIn: 6 }))).toBe(true);
    expect(isHotspot(node({ methodCount: 10, fanIn: 5 }))).toBe(false);
  });
});

describe('computePackageEdgeTiers', () => {
  it('returns empty for empty input', () => {
    expect(computePackageEdgeTiers([])).toEqual(new Map());
  });
  it('returns empty when all strengths are equal', () => {
    expect(computePackageEdgeTiers([3, 3, 3])).toEqual(new Map());
  });
  it('tiers strengths into heavy (5.0) and medium (3.0)', () => {
    const map = computePackageEdgeTiers([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(map.get(10)).toBe(5.0);
    expect(map.get(9)).toBe(5.0);
    expect(map.get(8)).toBe(3.0);
    expect(map.get(6)).toBe(3.0);
    expect(map.get(5)).toBeUndefined();
    expect(map.get(1)).toBeUndefined();
  });
});

describe('formatEntryLabel', () => {
  const entry = (overrides: Partial<EntryPoint> = {}): EntryPoint =>
    ({
      id: 'e1',
      protocol: 'http',
      framework: 'gin',
      path: '/api/x',
      handler: 'h',
      middleware: [],
      location: { file: 'main.go', line: 1 },
      ...overrides,
    }) as EntryPoint;
  it('formats http entries with method', () => {
    expect(formatEntryLabel(entry({ method: 'GET' }))).toBe('GET /api/x');
  });
  it('formats http entries with default method', () => {
    expect(formatEntryLabel(entry())).toBe('HTTP /api/x');
  });
  it('formats grpc/cli/message/scheduler entries', () => {
    expect(formatEntryLabel(entry({ protocol: 'grpc' }))).toBe('gRPC /api/x');
    expect(formatEntryLabel(entry({ protocol: 'cli', path: '' }))).toBe('CMD h');
    expect(formatEntryLabel(entry({ protocol: 'message' }))).toBe('MSG /api/x');
    expect(formatEntryLabel(entry({ protocol: 'scheduler' }))).toBe('CRON /api/x');
  });
  it('falls back to path or id', () => {
    const unknown = entry({ protocol: 'custom' as EntryPoint['protocol'], path: '' });
    expect(formatEntryLabel(unknown)).toBe('e1');
  });
});

describe('formatSpawnerLabel', () => {
  it('extracts the last two dot-segments after the final slash', () => {
    expect(formatSpawnerLabel('pkg/svc/handler.Run')).toBe('handler.Run');
    expect(formatSpawnerLabel('pkg/svc/Simple')).toBe('Simple');
  });
});

describe('formatChannelLabel', () => {
  it('strips chan- prefix and numeric suffix', () => {
    expect(formatChannelLabel('chan-orders-42')).toBe('orders');
    expect(formatChannelLabel('orders/queue-1')).toBe('queue');
  });
});

describe('formatGoroutineName', () => {
  it('returns the name after the last slash', () => {
    expect(formatGoroutineName({ id: 'x', name: 'pkg/svc/handler' })).toBe('handler');
  });
  it('returns an exported symbol from a dashed segment', () => {
    expect(formatGoroutineName({ id: 'x', name: 'pkg/svc/my-func.Run' })).toBe('Run');
  });
  it('falls back to id processing when name is empty', () => {
    expect(formatGoroutineName({ id: 'pkg/svc/handler.spawn-3', name: '' })).toBe('handler');
  });
});

describe('getLifecycleTag', () => {
  const lifecycle = [
    { nodeId: 'a', receivesContext: true, hasCancellationCheck: true },
    { nodeId: 'b', receivesContext: true, cancellationCheckAvailable: false },
    { nodeId: 'c', orphan: true },
  ];
  it('returns empty when no lifecycle entry', () => {
    expect(getLifecycleTag('zzz', lifecycle as never)).toBe('');
  });
  it('returns ctx checkmarks for healthy entries', () => {
    expect(getLifecycleTag('a', lifecycle as never)).toContain('ctx');
  });
  it('returns ctx? when cancellation check unavailable', () => {
    expect(getLifecycleTag('b', lifecycle as never)).toContain('ctx?');
  });
  it('returns no-exit warning for orphans', () => {
    expect(getLifecycleTag('c', lifecycle as never)).toContain('no exit');
  });
});

describe('packageOfEntry', () => {
  it('returns the entry package or the location dirname', () => {
    const entry = (overrides: Partial<EntryPoint> = {}) =>
      ({
        id: 'e',
        protocol: 'http',
        framework: 'gin',
        path: '/',
        handler: 'h',
        middleware: [],
        location: { file: '/repo/pkg/main.go', line: 1 },
        ...overrides,
      }) as EntryPoint;
    expect(packageOfEntry(entry({ package: 'pkg/hub' }))).toBe('pkg/hub');
    expect(packageOfEntry(entry({ package: undefined }))).toBe('/repo/pkg');
  });
});
