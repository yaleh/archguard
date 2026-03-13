/**
 * TDD tests for two bugs in ArchJsonMapper:
 *
 * Bug 1: mapEntities() uses pkg.name (short Go package name) instead of
 *   pkg.fullName (module-relative path) when generating entity IDs.
 *   Two packages in different directories sharing the same short name (e.g.
 *   both named "stress") produce identical, colliding IDs.
 *
 * Bug 2: mapRelations() references interface IDs as relation targets that do
 *   not exist in the entities array.  The missing method
 *   mapMissingInterfaceEntities() will scan relation targets and add any
 *   referenced interfaces found in packages that are absent from entities.
 */

import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '../../../src/plugins/golang/archjson-mapper.js';
import type {
  GoRawPackage,
  GoRawInterface,
  GoImport,
  InferredImplementation,
} from '../../../src/plugins/golang/types.js';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

const loc = (file = 'src.go', startLine = 1, endLine = 10) => ({
  file,
  startLine,
  endLine,
});

/** Minimal GoImport fixture */
function makeImport(importPath: string, alias?: string): GoImport {
  return { path: importPath, alias, location: loc() };
}

/** Minimal GoRawPackage with sane defaults */
function makePkg(
  overrides: Partial<GoRawPackage> & { name: string; fullName: string }
): GoRawPackage {
  return {
    id: overrides.fullName,
    dirPath: `/workspace/${overrides.fullName}`,
    imports: [],
    structs: [],
    interfaces: [],
    functions: [],
    sourceFiles: [`/workspace/${overrides.fullName}/pkg.go`],
    ...overrides,
  };
}

/** Minimal GoRawInterface */
function makeIface(name: string, packageName: string): GoRawInterface {
  return {
    name,
    packageName,
    methods: [],
    embeddedInterfaces: [],
    exported: true,
    location: loc(),
  };
}

/** Minimal InferredImplementation */
function makeImpl(
  structPkg: string,
  structName: string,
  ifacePkg: string,
  ifaceName: string
): InferredImplementation {
  return {
    structName,
    structPackageId: structPkg,
    interfaceName: ifaceName,
    interfacePackageId: ifacePkg,
    confidence: 1.0,
    matchedMethods: [],
    source: 'inferred',
  };
}

// ---------------------------------------------------------------------------
// Bug 1: Entity ID generation
// ---------------------------------------------------------------------------

describe('ArchJsonMapper - entity ID generation', () => {
  const mapper = new ArchJsonMapper();

  it('uses pkg.fullName as package discriminator in entity IDs', () => {
    const pkg = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
      structs: [
        {
          name: 'LoadRunner',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const entities = mapper.mapEntities([pkg]);

    expect(entities).toHaveLength(1);
    // With the bug: ID is "stress.LoadRunner"  (uses pkg.name)
    // After fix:    ID is "tests/stress.LoadRunner"  (uses pkg.fullName)
    expect(entities[0].id).toBe('tests/stress.LoadRunner');
  });

  it('uses pkg.name as fallback when pkg.fullName is empty string', () => {
    // parseCode (single-file) sets fullName to '' before the caller can set it
    const pkg = makePkg({
      name: 'main',
      fullName: '',
      structs: [
        {
          name: 'Server',
          packageName: 'main',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const entities = mapper.mapEntities([pkg]);

    expect(entities).toHaveLength(1);
    // Fallback: "main.Server"
    expect(entities[0].id).toBe('main.Server');
  });

  it('produces no duplicate IDs when two packages share the same short name but different fullNames', () => {
    const pkgA = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
      structs: [
        {
          name: 'Runner',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc('tests/stress/runner.go'),
        },
      ],
    });

    const pkgB = makePkg({
      name: 'stress',
      fullName: 'cmd/stress',
      structs: [
        {
          name: 'Runner',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc('cmd/stress/runner.go'),
        },
      ],
    });

    const entities = mapper.mapEntities([pkgA, pkgB]);

    // Bug present → both get ID "stress.Runner" → length still 2 but IDs collide
    // Bug fixed  → "tests/stress.Runner" and "cmd/stress.Runner"
    expect(entities).toHaveLength(2);

    const ids = entities.map((e) => e.id);
    expect(ids).toContain('tests/stress.Runner');
    expect(ids).toContain('cmd/stress.Runner');
    // No duplicate IDs
    expect(new Set(ids).size).toBe(2);
  });

  it('silently deduplicates when the SAME id appears twice (same package, same type name)', () => {
    // This can happen if tree-sitter emits a struct twice from the same file.
    // The mapper should skip the second occurrence.
    const pkg = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
      structs: [
        {
          name: 'Metrics',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
        {
          name: 'Metrics', // duplicate
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const entities = mapper.mapEntities([pkg]);

    // After fix uses fullName → ID "tests/stress.Metrics"
    // Second occurrence with same ID must be skipped
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('tests/stress.Metrics');
  });

  it('uses fullName for interface entities too', () => {
    const pkg = makePkg({
      name: 'hub',
      fullName: 'pkg/hub',
      interfaces: [makeIface('Store', 'hub')],
    });

    const entities = mapper.mapEntities([pkg]);

    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('pkg/hub.Store');
    expect(entities[0].type).toBe('interface');
  });
});

// ---------------------------------------------------------------------------
// Relation ID consistency
// ---------------------------------------------------------------------------

describe('ArchJsonMapper - relation IDs use fullName', () => {
  const mapper = new ArchJsonMapper();

  it('relation source uses structPackageId (fullName after index.ts fix) and target uses interfacePackageId', () => {
    const impl = makeImpl('tests/stress', 'Runner', 'pkg/hub', 'Store');
    const relations = mapper.mapRelations([], [impl]);

    expect(relations).toHaveLength(1);
    const rel = relations[0];
    expect(rel.source).toBe('tests/stress.Runner');
    expect(rel.target).toBe('pkg/hub.Store');
    expect(rel.type).toBe('implementation');
  });
});

// ---------------------------------------------------------------------------
// Bug 2: mapMissingInterfaceEntities
// ---------------------------------------------------------------------------

describe('ArchJsonMapper - mapMissingInterfaceEntities', () => {
  const mapper = new ArchJsonMapper();

  it('returns empty array when all relation targets already exist in entities', () => {
    const pkg = makePkg({
      name: 'hub',
      fullName: 'pkg/hub',
      interfaces: [makeIface('Store', 'hub')],
      structs: [
        {
          name: 'MemStore',
          packageName: 'hub',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const entities = mapper.mapEntities([pkg]);
    // Store IS in entities already (mapEntities includes interfaces)
    const impl = makeImpl('pkg/hub', 'MemStore', 'pkg/hub', 'Store');
    const relations = mapper.mapRelations([pkg], [impl]);

    // All targets are covered — no missing entities
    const missing = (mapper as any).mapMissingInterfaceEntities(entities, relations, [pkg]);
    expect(missing).toHaveLength(0);
  });

  it('adds interface entity for a relation target not in the current entity set', () => {
    // Simulate a scenario where mapEntities was called WITHOUT the hub package
    // (so the Store interface is absent), but relations reference it.
    const stressPkg = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
      structs: [
        {
          name: 'Runner',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const hubPkg = makePkg({
      name: 'hub',
      fullName: 'pkg/hub',
      interfaces: [makeIface('Store', 'hub')],
    });

    // Only map entities from stressPkg — hubPkg entities intentionally absent
    const entities = mapper.mapEntities([stressPkg]);
    expect(entities.map((e) => e.id)).not.toContain('pkg/hub.Store');

    const impl = makeImpl('tests/stress', 'Runner', 'pkg/hub', 'Store');
    const relations = mapper.mapRelations([stressPkg, hubPkg], [impl]);

    // Bug 2 fix: scan relations and add missing interface entities
    const missing = (mapper as any).mapMissingInterfaceEntities(entities, relations, [
      stressPkg,
      hubPkg,
    ]);

    expect(missing).toHaveLength(1);
    expect(missing[0].id).toBe('pkg/hub.Store');
    expect(missing[0].type).toBe('interface');
    expect(missing[0].name).toBe('Store');
  });

  it('does not add duplicate when interface is already in entities', () => {
    const hubPkg = makePkg({
      name: 'hub',
      fullName: 'pkg/hub',
      interfaces: [makeIface('Store', 'hub')],
    });

    // mapEntities DOES include the hub package this time
    const entities = mapper.mapEntities([hubPkg]);
    expect(entities.map((e) => e.id)).toContain('pkg/hub.Store');

    const impl = makeImpl('pkg/hub', 'MemStore', 'pkg/hub', 'Store');
    const relations = mapper.mapRelations([hubPkg], [impl]);

    const missing = (mapper as any).mapMissingInterfaceEntities(entities, relations, [hubPkg]);
    expect(missing).toHaveLength(0);
  });

  it('handles relation target from a package not in packages list (external dep) gracefully', () => {
    const stressPkg = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
      structs: [
        {
          name: 'Runner',
          packageName: 'stress',
          exported: true,
          fields: [],
          methods: [],
          embeddedTypes: [],
          location: loc(),
        },
      ],
    });

    const entities = mapper.mapEntities([stressPkg]);

    // Target refers to an external package not present in the packages list
    const impl = makeImpl('tests/stress', 'Runner', 'github.com/external/pkg', 'SomeInterface');
    const relations = mapper.mapRelations([stressPkg], [impl]);

    // Must not crash; external dep cannot be resolved → no new entity added
    expect(() => {
      const missing = (mapper as any).mapMissingInterfaceEntities(entities, relations, [stressPkg]);
      expect(missing).toHaveLength(0);
    }).not.toThrow();
  });

  it('only processes implementation relations, not other types (dependency relations are not scanned)', () => {
    const hubPkg = makePkg({
      name: 'hub',
      fullName: 'pkg/hub',
      interfaces: [makeIface('Store', 'hub')],
    });

    const stressPkg = makePkg({
      name: 'stress',
      fullName: 'tests/stress',
    });

    // mapEntities for stressPkg only — Store is absent
    const entities = mapper.mapEntities([stressPkg]);

    // A dependency relation (not implementation) points at Store
    const relations = [
      {
        id: 'dep-0',
        type: 'dependency' as const,
        source: 'tests/stress.Runner',
        target: 'pkg/hub.Store',
      },
    ];

    // Non-implementation relations must be ignored by mapMissingInterfaceEntities
    const missing = (mapper as any).mapMissingInterfaceEntities(entities, relations, [
      stressPkg,
      hubPkg,
    ]);
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Plan-33: Import dependency edges
// ---------------------------------------------------------------------------

describe('mapRelations — dependency edges', () => {
  const mapper = new ArchJsonMapper();
  const MODULE = 'github.com/org/app';

  it('1: emits a dependency relation for a same-module import', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`)],
    });
    const svc = makePkg({ name: 'svc', fullName: 'internal/svc' });

    const relations = mapper.mapRelations([api, svc], [], MODULE);
    const deps = relations.filter((r) => r.type === 'dependency');

    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('internal/api');
    expect(deps[0].target).toBe('internal/svc');
  });

  it('2: excludes stdlib imports (no module prefix)', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport('fmt'), makeImport('context')],
    });

    const relations = mapper.mapRelations([api], [], MODULE);
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });

  it('3: excludes external module imports (different module prefix)', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport('github.com/gin-gonic/gin')],
    });

    const relations = mapper.mapRelations([api], [], MODULE);
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });

  it('4: emits zero relations when moduleName is unknown (no match)', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`)],
    });
    const svc = makePkg({ name: 'svc', fullName: 'internal/svc' });

    const relations = mapper.mapRelations([api, svc], [], 'unknown.module/other');
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });

  it('5: deduplicates duplicate imports of the same path', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`), makeImport(`${MODULE}/internal/svc`)],
    });
    const svc = makePkg({ name: 'svc', fullName: 'internal/svc' });

    const relations = mapper.mapRelations([api, svc], [], MODULE);
    const deps = relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
  });

  it('6: guards against self-imports (source === target)', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/api`)],
    });

    const relations = mapper.mapRelations([api], [], MODULE);
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });

  it('7: emits dependency relation for blank import (alias="_")', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`, '_')],
    });
    const svc = makePkg({ name: 'svc', fullName: 'internal/svc' });

    const relations = mapper.mapRelations([api, svc], [], MODULE);
    const deps = relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('internal/api');
    expect(deps[0].target).toBe('internal/svc');
  });

  it('8: coexists with implementation relations without collision', () => {
    const api = makePkg({
      name: 'api',
      fullName: 'internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`)],
      interfaces: [makeIface('Handler', 'api')],
    });
    const svc = makePkg({ name: 'svc', fullName: 'internal/svc' });
    const impl = makeImpl('internal/svc', 'ServiceImpl', 'internal/api', 'Handler');

    const relations = mapper.mapRelations([api, svc], [impl], MODULE);
    const deps = relations.filter((r) => r.type === 'dependency');
    const impls = relations.filter((r) => r.type === 'implementation');

    expect(deps).toHaveLength(1);
    expect(impls).toHaveLength(1);
  });

  it('9: emits two dependency relations for a three-package chain (A→B→C)', () => {
    const a = makePkg({
      name: 'a',
      fullName: 'internal/a',
      imports: [makeImport(`${MODULE}/internal/b`)],
    });
    const b = makePkg({
      name: 'b',
      fullName: 'internal/b',
      imports: [makeImport(`${MODULE}/internal/c`)],
    });
    const c = makePkg({ name: 'c', fullName: 'internal/c' });

    const relations = mapper.mapRelations([a, b, c], [], MODULE);
    const deps = relations.filter((r) => r.type === 'dependency');

    expect(deps).toHaveLength(2);
    const sources = deps.map((r) => r.source);
    const targets = deps.map((r) => r.target);
    expect(sources).toContain('internal/a');
    expect(targets).toContain('internal/b');
    expect(sources).toContain('internal/b');
    expect(targets).toContain('internal/c');
  });

  it('10: emits no dependency relations when imports array is empty', () => {
    const api = makePkg({ name: 'api', fullName: 'internal/api', imports: [] });

    const relations = mapper.mapRelations([api], [], MODULE);
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });

  it('11: emits zero relations when fullNames are absolute paths (parseFiles-style)', () => {
    // In parseFiles mode, pkg.fullName is an absolute filesystem path like
    // "/workspace/internal/api". These never match the stripped import suffix
    // "internal/api" so no dependency relations should be emitted.
    const api = makePkg({
      name: 'api',
      fullName: '/workspace/internal/api',
      imports: [makeImport(`${MODULE}/internal/svc`)],
    });
    const svc = makePkg({ name: 'svc', fullName: '/workspace/internal/svc' });

    const relations = mapper.mapRelations([api, svc], [], MODULE);
    expect(relations.filter((r) => r.type === 'dependency')).toHaveLength(0);
  });
});
