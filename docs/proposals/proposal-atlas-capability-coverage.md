# Go Atlas Capability Layer: Coverage for Interface-Free Packages

> Status: Draft (rev 1)
> Scope: Include high-complexity concrete packages in the Capability diagram
> Branch: `feat/atlas-capability-coverage` (future)

---

## Background

The Capability layer (`CapabilityGraphBuilder`) builds all struct/interface nodes from
the raw data, then applies an interface-centric filter:

```typescript
const nodes = allNodes.filter(
  (node) => node.type === 'interface' || referencedIds.has(node.id)
);
```

This is intentional: the Capability layer visualises the interface polymorphism landscape.
However, it silently omits entire packages that contain concrete structs but no interface
relationships.

When ArchGuard was run against `meta-cc`, the Capability diagram (38 nodes) missed:
- `internal/query` — 32 structs, 74 functions, the most complex package in the project
- `internal/output` — 8 structs, 34 functions
- `cmd/mcp-server` — 5 structs, 63 functions (the entry point)

These are architecturally significant packages. Their absence from the Capability diagram
creates a blind spot: the diagram looks clean while the real complexity hides off-screen.

---

## Root Cause

The filter is correct for its design goal (interface-centric). The problem is that there
is no fallback for packages whose complexity is NOT expressed through interfaces.

Go projects often separate concerns this way:
- Domain interfaces in small packages (`internal/analysis`, `internal/filter`)  
- Heavy concrete implementations in large packages (`internal/query`, `cmd/mcp-server`)

The current design renders the domain layer well but misses the implementation layer.

---

## Goals

- Include **hotspot structs** in the Capability diagram even when they have no interface
  relationships, using the same hotspot threshold already used by the Mermaid template
  (`≥11 methods OR fan-in > 5`)
- Include **all structs** from packages with high aggregate complexity (configurable:
  package struct count ≥ threshold, default 8) even without interface relationships
- Mark these additional nodes clearly with a distinct `:::concrete-heavy` style so
  readers understand they appear due to complexity, not interface polymorphism
- Keep the existing interface-centric filter as the primary rule; this is additive only
- Add a CLI flag `--capability-mode` with values:
  - `interface` (current default): interfaces + related structs only
  - `full`: interfaces + related structs + hotspot structs + complex-package structs

---

## Non-Goals

- Changing the interface-centric filter when `--capability-mode interface` (default)
- Showing functions or methods as individual nodes (struct-level granularity is sufficient)
- Package-level aggregation nodes (that's the Package layer's job)

---

## Design

### 1. Hotspot struct inclusion

After the interface-centric filter in `CapabilityGraphBuilder.build()`, add a second pass:

```typescript
// Hotspot inclusion (additive): structs with methodCount ≥ 11 OR fanIn > 5
if (options.mode !== 'interface') {
  const hotspotIds = new Set(
    allNodes
      .filter(n => n.type === 'struct' && (n.methodCount >= 11 || n.fanIn > 5))
      .map(n => n.id)
  );
  const extra = allNodes.filter(n => !referencedIds.has(n.id) && hotspotIds.has(n.id));
  for (const node of extra) {
    node.isHotspotAdded = true; // flag for Mermaid template styling
  }
  nodes.push(...extra);
}
```

### 2. Complex-package struct inclusion

When a package has `structs.length >= minPackageStructs` (default 8) and none of its
structs appear in the filtered node list, include ALL structs of that package:

```typescript
if (options.mode !== 'interface') {
  const packageStructCounts = new Map<string, number>();
  for (const n of allNodes.filter(n => n.type === 'struct')) {
    packageStructCounts.set(n.package, (packageStructCounts.get(n.package) ?? 0) + 1);
  }
  const includedPackages = new Set(nodes.map(n => n.package));
  for (const [pkg, count] of packageStructCounts) {
    if (count >= minPackageStructs && !includedPackages.has(pkg)) {
      const pkgStructs = allNodes.filter(n => n.type === 'struct' && n.package === pkg);
      pkgStructs.forEach(n => (n.isPackageHotspot = true));
      nodes.push(...pkgStructs);
    }
  }
}
```

### 3. Mermaid template changes

`capability-mermaid-template.ts` already uses `:::hotspot` for nodes with high method/
fan-in counts. Add a new `:::concrete` class for `isHotspotAdded` / `isPackageHotspot`
nodes to visually distinguish them from interface-connected structs:

```typescript
classDef concrete fill:#fff3cd,stroke:#856404,color:#533f03
```

### 4. `CapabilityBuildOptions.mode` field

Add `mode?: 'interface' | 'full'` to `CapabilityBuildOptions` (new type, passed into
`CapabilityGraphBuilder.build()`). The default is `'interface'` to preserve existing
behaviour. The Atlas coordinator reads this from `AtlasConfig.capabilityMode`.

### 5. CLI flag

```
--atlas-capability-mode <mode>   Capability layer coverage: interface (default) | full
```

---

## Plan

| Phase | Work |
|---|---|
| 1 | Add `mode` to `CapabilityBuildOptions`; pass through coordinator |
| 2 | Hotspot struct inclusion pass in `CapabilityGraphBuilder.build()` |
| 3 | Complex-package struct inclusion pass |
| 4 | `:::concrete` Mermaid class in capability template |
| 5 | `--atlas-capability-mode` CLI flag |
| 6 | Unit tests for both inclusion passes; integration test verifying `internal/query` appears in `full` mode for meta-cc |

---

## Expected Result for meta-cc (full mode)

- `internal/query` visible: 32 structs (all marked `:::concrete`)
- `cmd/mcp-server` visible: 5 structs
- `internal/output` visible: 8 structs
- Existing interface nodes and their connected structs unchanged
- Total node count: ~38 (current) + ~45 (new concrete nodes) = ~83 nodes
