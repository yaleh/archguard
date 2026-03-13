/**
 * Tests for Python ArchJsonMapper
 *
 * P0.1 - entity ID collision: IDs must use dotted Python path, not bare filename
 * P0.3 - decorator double-counting: module-level function decorators must not be
 *         duplicated on the sole member
 */
import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/python/archjson-mapper.js';
import type { PythonRawModule, PythonRawImport } from '@/plugins/python/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_WS = '/home/user/project';

function makeModule(overrides: Partial<PythonRawModule> = {}): PythonRawModule {
  return {
    name: 'utils',
    filePath: `${BASE_WS}/myapp/utils.py`,
    classes: [],
    functions: [],
    imports: [],
    ...overrides,
  };
}

function makeImport(module: string, items?: Array<{ name: string }>): PythonRawImport {
  return { module, items };
}

function makeClass(overrides: Partial<import('@/plugins/python/types.js').PythonRawClass> = {}): import('@/plugins/python/types.js').PythonRawClass {
  return {
    name: 'MyClass',
    moduleName: 'mymodule',
    baseClasses: [],
    methods: [],
    properties: [],
    classAttributes: [],
    decorators: [],
    filePath: `${BASE_WS}/myapp/mymodule.py`,
    startLine: 1,
    endLine: 10,
    ...overrides,
  };
}

function makeMethod(name: string): import('@/plugins/python/types.js').PythonRawMethod {
  return {
    name,
    parameters: [],
    returnType: undefined,
    decorators: [],
    isClassMethod: false,
    isStaticMethod: false,
    isProperty: false,
    isAsync: false,
    isPrivate: false,
    startLine: 2,
    endLine: 4,
  };
}

// ---------------------------------------------------------------------------
// P0.1 — Entity ID collision fix
// ---------------------------------------------------------------------------

describe('ArchJsonMapper – entity ID (P0.1)', () => {
  it('uses dotted module path from workspaceRoot for a class entity', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      filePath: `${BASE_WS}/myapp/models/user.py`,
      classes: [
        {
          name: 'User',
          moduleName: 'user',
          baseClasses: [],
          methods: [],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/models/user.py`,
          startLine: 1,
          endLine: 10,
        },
      ],
    });

    const result = mapper.mapModules([module], BASE_WS);
    const entity = result.entities.find((e) => e.name === 'User');
    expect(entity).toBeDefined();
    expect(entity!.id).toBe('myapp.models.user.User');
  });

  it('uses dotted module path for a function entity', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      filePath: `${BASE_WS}/myapp/utils.py`,
      functions: [
        {
          name: 'my_func',
          moduleName: 'utils',
          parameters: [],
          decorators: [],
          isAsync: false,
          filePath: `${BASE_WS}/myapp/utils.py`,
          startLine: 5,
          endLine: 8,
        },
      ],
    });

    const result = mapper.mapModules([module], BASE_WS);
    const entity = result.entities.find((e) => e.name === 'my_func');
    expect(entity).toBeDefined();
    expect(entity!.id).toBe('myapp.utils.my_func');
  });

  it('handles __init__.py by using parent directory name', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      filePath: `${BASE_WS}/myapp/engine/__init__.py`,
      classes: [
        {
          name: 'Engine',
          moduleName: '__init__',
          baseClasses: [],
          methods: [],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/engine/__init__.py`,
          startLine: 1,
          endLine: 20,
        },
      ],
    });

    const result = mapper.mapModules([module], BASE_WS);
    const entity = result.entities.find((e) => e.name === 'Engine');
    expect(entity).toBeDefined();
    // __init__.py → use parent dir: myapp.engine.Engine
    expect(entity!.id).toBe('myapp.engine.Engine');
  });

  it('avoids ID collision: two classes named "Config" in different modules get distinct IDs', () => {
    const mapper = new ArchJsonMapper();
    const moduleA: PythonRawModule = {
      name: 'config',
      filePath: `${BASE_WS}/myapp/serve/config.py`,
      classes: [
        {
          name: 'Config',
          moduleName: 'config',
          baseClasses: [],
          methods: [],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/serve/config.py`,
          startLine: 1,
          endLine: 10,
        },
      ],
      functions: [],
      imports: [],
    };
    const moduleB: PythonRawModule = {
      name: 'config',
      filePath: `${BASE_WS}/myapp/engine/config.py`,
      classes: [
        {
          name: 'Config',
          moduleName: 'config',
          baseClasses: [],
          methods: [],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/engine/config.py`,
          startLine: 1,
          endLine: 10,
        },
      ],
      functions: [],
      imports: [],
    };

    const result = mapper.mapModules([moduleA, moduleB], BASE_WS);
    const ids = result.entities.filter((e) => e.name === 'Config').map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).toContain('myapp.serve.config.Config');
    expect(ids).toContain('myapp.engine.config.Config');
  });

  it('falls back to filename-stem ID when no workspaceRoot is provided', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        {
          name: 'Helper',
          moduleName: 'utils',
          baseClasses: [],
          methods: [],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/utils.py`,
          startLine: 1,
          endLine: 5,
        },
      ],
    });

    const result = mapper.mapModules([module]); // no workspaceRoot
    const entity = result.entities.find((e) => e.name === 'Helper');
    expect(entity).toBeDefined();
    // Falls back to moduleName.ClassName
    expect(entity!.id).toBe('utils.Helper');
  });
});

// ---------------------------------------------------------------------------
// P0.3 — Decorator double-counting fix
// ---------------------------------------------------------------------------

describe('ArchJsonMapper – decorator double-counting (P0.3)', () => {
  it('does not duplicate decorators on the sole member of a function entity', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      functions: [
        {
          name: 'my_kernel',
          moduleName: 'kernels',
          parameters: [],
          decorators: [{ name: 'triton.jit', arguments: [] }],
          isAsync: false,
          filePath: `${BASE_WS}/myapp/kernels.py`,
          startLine: 1,
          endLine: 10,
        },
      ],
    });

    const result = mapper.mapModules([module]);
    const entity = result.entities.find((e) => e.name === 'my_kernel');
    expect(entity).toBeDefined();

    // Decorator must appear at entity level
    expect(entity!.decorators).toHaveLength(1);
    expect(entity!.decorators![0].name).toBe('triton.jit');

    // Member must NOT carry the decorator (no double-count)
    const member = entity!.members![0];
    expect(member.decorators).toBeUndefined();
  });

  it('function entity without decorators has no decorators on entity or member', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      functions: [
        {
          name: 'plain_func',
          moduleName: 'utils',
          parameters: [],
          decorators: [],
          isAsync: false,
          filePath: `${BASE_WS}/myapp/utils.py`,
          startLine: 1,
          endLine: 5,
        },
      ],
    });

    const result = mapper.mapModules([module]);
    const entity = result.entities.find((e) => e.name === 'plain_func');
    expect(entity!.decorators).toBeUndefined();
    expect(entity!.members![0].decorators).toBeUndefined();
  });

  it('class method decorators are still preserved on the member', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        {
          name: 'MyModel',
          moduleName: 'model',
          baseClasses: [],
          methods: [
            {
              name: 'forward',
              parameters: [],
              decorators: [{ name: 'torch.no_grad', arguments: [] }],
              isPrivate: false,
              isClassMethod: false,
              isStaticMethod: false,
              isProperty: false,
              isAsync: false,
              startLine: 5,
              endLine: 10,
            },
          ],
          properties: [],
          classAttributes: [],
          decorators: [],
          filePath: `${BASE_WS}/myapp/model.py`,
          startLine: 1,
          endLine: 15,
        },
      ],
    });

    const result = mapper.mapModules([module]);
    const entity = result.entities.find((e) => e.name === 'MyModel');
    const method = entity!.members!.find((m) => m.name === 'forward');
    expect(method!.decorators).toHaveLength(1);
    expect(method!.decorators![0].name).toBe('torch.no_grad');
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — dependency relation source ID format
// ---------------------------------------------------------------------------

describe('ArchJsonMapper – dependency relation source ID (Fix 3)', () => {
  it('source ID uses dotted path (not module: prefix) when workspaceRoot is provided', () => {
    const mapper = new ArchJsonMapper();
    // Use a project-internal import so the relation is emitted (stdlib filtered)
    const target = makeModule({ name: 'helpers', filePath: `${BASE_WS}/myapp/helpers.py`, imports: [] });
    const module = makeModule({
      filePath: `${BASE_WS}/myapp/utils.py`,
      imports: [makeImport('myapp.helpers')],
    });

    const result = mapper.mapModules([target, module], BASE_WS);
    const rel = result.relations.find((r) => r.type === 'dependency');
    expect(rel).toBeDefined();
    expect(rel!.source).not.toMatch(/^module:/);
    expect(rel!.source).toBe('myapp.utils');
  });

  it('source ID falls back to bare moduleName (no module: prefix) without workspaceRoot', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      name: 'utils',
      filePath: `${BASE_WS}/myapp/utils.py`,
      imports: [],
    });

    // Without workspaceRoot, no dependency relations are emitted.
    // We verify that inheritance source IDs (if any) don't use "module:" prefix.
    const result = mapper.mapModules([module]);
    for (const rel of result.relations) {
      expect(rel.source).not.toMatch(/^module:/);
    }
  });

  it('__init__.py module source ID resolves to parent directory dotted path', () => {
    const mapper = new ArchJsonMapper();
    const target = makeModule({ name: 'helpers', filePath: `${BASE_WS}/myapp/helpers.py`, imports: [] });
    const module = makeModule({
      name: '__init__',
      filePath: `${BASE_WS}/myapp/engine/__init__.py`,
      imports: [makeImport('myapp.helpers')],
    });

    const result = mapper.mapModules([target, module], BASE_WS);
    const rel = result.relations.find((r) => r.type === 'dependency');
    expect(rel!.source).toBe('myapp.engine');
  });

  it('no relation source starts with "module:" prefix', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      imports: [
        { module: 'os', names: [] },
        { module: 'sys', names: [] },
        { module: 'pathlib', names: [] },
      ],
    });

    const result = mapper.mapModules([module], BASE_WS);
    for (const rel of result.relations) {
      expect(rel.source).not.toMatch(/^module:/);
    }
  });
});

// ---------------------------------------------------------------------------
// P0.2 — workspaceRoot written to ArchJSON
// ---------------------------------------------------------------------------

describe('ArchJsonMapper – workspaceRoot in output (P0.2)', () => {
  it('sets workspaceRoot on the returned ArchJSON when provided', () => {
    const mapper = new ArchJsonMapper();
    const result = mapper.mapModules([makeModule()], BASE_WS);
    expect(result.workspaceRoot).toBe(BASE_WS);
  });

  it('does not set workspaceRoot when not provided', () => {
    const mapper = new ArchJsonMapper();
    const result = mapper.mapModules([makeModule()]);
    expect(result.workspaceRoot).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Plan-35: Import dependency edges (Stage 1.1 — 14 unit tests)
// ---------------------------------------------------------------------------

describe('mapModules — dependency relations (plan-35)', () => {
  const WS = '/project';

  it('1: emits dependency relation for absolute import of a known module', () => {
    const base = makeModule({ name: 'base', filePath: `${WS}/lmdeploy/models/base.py`, imports: [] });
    const engine = makeModule({
      name: 'engine',
      filePath: `${WS}/lmdeploy/engine.py`,
      imports: [makeImport('lmdeploy.models.base')],
    });

    const deps = new ArchJsonMapper().mapModules([base, engine], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('lmdeploy.engine');
    expect(deps[0].target).toBe('lmdeploy.models.base');
  });

  it('2: emits dependency relation for relative import .utils (same directory)', () => {
    const utils = makeModule({ name: 'utils', filePath: `${WS}/lmdeploy/models/utils.py`, imports: [] });
    const base = makeModule({
      name: 'base',
      filePath: `${WS}/lmdeploy/models/base.py`,
      imports: [makeImport('.utils')],
    });

    const deps = new ArchJsonMapper().mapModules([utils, base], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('lmdeploy.models.base');
    expect(deps[0].target).toBe('lmdeploy.models.utils');
  });

  it('3: emits dependency relation for relative import ..common (parent directory)', () => {
    const common = makeModule({ name: 'common', filePath: `${WS}/lmdeploy/common.py`, imports: [] });
    const base = makeModule({
      name: 'base',
      filePath: `${WS}/lmdeploy/models/base.py`,
      imports: [makeImport('..common')],
    });

    const deps = new ArchJsonMapper().mapModules([common, base], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('lmdeploy.models.base');
    expect(deps[0].target).toBe('lmdeploy.common');
  });

  it('4: excludes stdlib imports (not in module index)', () => {
    const m = makeModule({ name: 'engine', filePath: `${WS}/lmdeploy/engine.py`, imports: [makeImport('os'), makeImport('sys')] });
    const deps = new ArchJsonMapper().mapModules([m], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(0);
  });

  it('5: excludes third-party imports not in module index', () => {
    const m = makeModule({ name: 'engine', filePath: `${WS}/lmdeploy/engine.py`, imports: [makeImport('torch'), makeImport('numpy')] });
    const deps = new ArchJsonMapper().mapModules([m], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(0);
  });

  it('6: resolves import of __init__.py package module', () => {
    // lmdeploy/models/__init__.py → module ID "lmdeploy.models"
    const init = makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/models/__init__.py`, imports: [] });
    const engine = makeModule({
      name: 'engine',
      filePath: `${WS}/lmdeploy/engine.py`,
      imports: [makeImport('lmdeploy.models')],
    });

    const deps = new ArchJsonMapper().mapModules([init, engine], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('lmdeploy.models');
  });

  it('7: guards against self-imports (source === target)', () => {
    const m = makeModule({
      name: 'engine',
      filePath: `${WS}/lmdeploy/engine.py`,
      imports: [makeImport('lmdeploy.engine')],
    });
    const deps = new ArchJsonMapper().mapModules([m], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(0);
  });

  it('8: deduplicates duplicate import entries for the same module', () => {
    const base = makeModule({ name: 'base', filePath: `${WS}/lmdeploy/models/base.py`, imports: [] });
    const engine = makeModule({
      name: 'engine',
      filePath: `${WS}/lmdeploy/engine.py`,
      imports: [makeImport('lmdeploy.models.base'), makeImport('lmdeploy.models.base')],
    });

    const deps = new ArchJsonMapper().mapModules([base, engine], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
  });

  it('9: emits 2 relations for A→B→C chain', () => {
    const a = makeModule({ name: 'a', filePath: `${WS}/lmdeploy/a.py`, imports: [makeImport('lmdeploy.b')] });
    const b = makeModule({ name: 'b', filePath: `${WS}/lmdeploy/b.py`, imports: [makeImport('lmdeploy.c')] });
    const c = makeModule({ name: 'c', filePath: `${WS}/lmdeploy/c.py`, imports: [] });

    const deps = new ArchJsonMapper().mapModules([a, b, c], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(2);
    const edges = deps.map((r) => `${r.source}->${r.target}`);
    expect(edges).toContain('lmdeploy.a->lmdeploy.b');
    expect(edges).toContain('lmdeploy.b->lmdeploy.c');
  });

  it('10: emits no dependency relations when imports is empty', () => {
    const m = makeModule({ name: 'engine', filePath: `${WS}/lmdeploy/engine.py`, imports: [] });
    const deps = new ArchJsonMapper().mapModules([m], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(0);
  });

  it('11: silently skips relative import when workspaceRoot is not provided', () => {
    const utils = makeModule({ name: 'utils', filePath: `${WS}/lmdeploy/utils.py`, imports: [] });
    const base = makeModule({ name: 'base', filePath: `${WS}/lmdeploy/base.py`, imports: [makeImport('.utils')] });
    // No workspaceRoot → relative imports unresolvable
    const deps = new ArchJsonMapper().mapModules([utils, base]).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(0);
  });

  it('12: resolves bare relative import "." to the package __init__.py', () => {
    const init = makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/models/__init__.py`, imports: [] });
    const base = makeModule({
      name: 'base',
      filePath: `${WS}/lmdeploy/models/base.py`,
      imports: [makeImport('.')],
    });

    const deps = new ArchJsonMapper().mapModules([init, base], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('lmdeploy.models');
  });

  it('13: coexists with inheritance relations without collision', () => {
    const base = makeModule({ name: 'base', filePath: `${WS}/lmdeploy/base.py`, imports: [] });
    const child = makeModule({
      name: 'child',
      filePath: `${WS}/lmdeploy/child.py`,
      imports: [makeImport('lmdeploy.base')],
      classes: [{
        name: 'Child',
        moduleName: 'child',
        baseClasses: ['Base'],
        methods: [],
        properties: [],
        classAttributes: [],
        decorators: [],
        filePath: `${WS}/lmdeploy/child.py`,
        startLine: 1,
        endLine: 5,
      }],
    });

    const result = new ArchJsonMapper().mapModules([base, child], WS);
    const deps = result.relations.filter((r) => r.type === 'dependency');
    const inheritances = result.relations.filter((r) => r.type === 'inheritance');
    expect(deps).toHaveLength(1);
    expect(inheritances).toHaveLength(1);
  });

  it('14: strips " as alias" suffix before resolving aliased import', () => {
    const base = makeModule({ name: 'base', filePath: `${WS}/lmdeploy/models/base.py`, imports: [] });
    const consumer = makeModule({
      name: 'consumer',
      filePath: `${WS}/lmdeploy/consumer.py`,
      imports: [makeImport('lmdeploy.models.base as base')],
    });

    const deps = new ArchJsonMapper().mapModules([base, consumer], WS).relations.filter((r) => r.type === 'dependency');
    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('lmdeploy.models.base');
  });
});

// ---------------------------------------------------------------------------
// Plan-35: Cross-package integration fixture (Stage 2.1)
// ---------------------------------------------------------------------------

describe('mapModules — cross-package integration fixture (plan-35)', () => {
  const WS = '/project';

  it('emits correct 4 dependency relations for a realistic multi-package fixture', () => {
    const modules: PythonRawModule[] = [
      makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/__init__.py`, imports: [] }),
      makeModule({
        name: 'engine',
        filePath: `${WS}/lmdeploy/engine.py`,
        imports: [
          makeImport('lmdeploy.models.base'),  // absolute cross-package
          makeImport('.utils'),                 // relative same-dir
          makeImport('lmdeploy.common'),        // absolute sibling module
        ],
      }),
      makeModule({ name: 'utils',  filePath: `${WS}/lmdeploy/utils.py`,  imports: [] }),
      makeModule({ name: 'common', filePath: `${WS}/lmdeploy/common.py`, imports: [] }),
      makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/models/__init__.py`, imports: [] }),
      makeModule({
        name: 'base',
        filePath: `${WS}/lmdeploy/models/base.py`,
        imports: [
          makeImport('lmdeploy.models'),  // resolves to __init__
          makeImport('torch'),            // third-party — excluded
        ],
      }),
    ];

    const result = new ArchJsonMapper().mapModules(modules, WS);
    const deps = result.relations.filter((r) => r.type === 'dependency');
    const edges = deps.map((r) => `${r.source} -> ${r.target}`).sort();

    expect(edges).toContain('lmdeploy.engine -> lmdeploy.models.base');
    expect(edges).toContain('lmdeploy.engine -> lmdeploy.utils');
    expect(edges).toContain('lmdeploy.engine -> lmdeploy.common');
    expect(edges).toContain('lmdeploy.models.base -> lmdeploy.models');
    expect(deps).toHaveLength(4);

    // No third-party or self edges
    expect(deps.find((r) => r.target === 'torch')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Plan 43 — classAttributes → Member[] mapping
// ---------------------------------------------------------------------------

describe('ArchJsonMapper (Python) — mapClass classAttributes (Plan 43)', () => {
  it('maps classAttributes to field Members', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        makeClass({
          classAttributes: [
            { name: 'max_tokens', type: 'int', isPrivate: false },
            { name: 'temperature', type: 'float', isPrivate: false },
          ],
        }),
      ],
    });

    const result = mapper.mapModules([module], BASE_WS);

    expect(result.entities).toHaveLength(1);
    const entity = result.entities[0];
    const fieldMembers = entity.members.filter((m) => m.type === 'field');
    expect(fieldMembers).toHaveLength(2);
    expect(fieldMembers[0]).toMatchObject({ name: 'max_tokens', type: 'field', visibility: 'public', fieldType: 'int' });
    expect(fieldMembers[1]).toMatchObject({ name: 'temperature', type: 'field', visibility: 'public', fieldType: 'float' });
  });

  it('sets visibility: private for _private attributes', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        makeClass({
          classAttributes: [{ name: '_cache', type: 'dict', isPrivate: true }],
        }),
      ],
    });
    const result = mapper.mapModules([module], BASE_WS);
    const fieldMembers = result.entities[0].members.filter((m) => m.type === 'field');
    expect(fieldMembers[0]).toMatchObject({ name: '_cache', visibility: 'private' });
  });

  it('maps fieldType from type annotation', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        makeClass({
          classAttributes: [{ name: 'top_p', type: 'Optional[float]', isPrivate: false }],
        }),
      ],
    });
    const result = mapper.mapModules([module], BASE_WS);
    const field = result.entities[0].members.find((m) => m.name === 'top_p');
    expect(field?.fieldType).toBe('Optional[float]');
  });

  it('produces both field members and method members', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        makeClass({
          classAttributes: [{ name: 'value', type: 'int', isPrivate: false }],
          methods: [makeMethod('compute')],
        }),
      ],
    });
    const result = mapper.mapModules([module], BASE_WS);
    const entity = result.entities[0];
    expect(entity.members.filter((m) => m.type === 'field')).toHaveLength(1);
    expect(entity.members.filter((m) => m.type === 'method')).toHaveLength(1);
  });

  it('class with no classAttributes still maps correctly (empty array — no regression)', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      classes: [
        makeClass({
          classAttributes: [],
          methods: [makeMethod('do_something')],
        }),
      ],
    });
    const result = mapper.mapModules([module], BASE_WS);
    const entity = result.entities[0];
    expect(entity.members.filter((m) => m.type === 'field')).toHaveLength(0);
    expect(entity.members.filter((m) => m.type === 'method')).toHaveLength(1);
  });
});
