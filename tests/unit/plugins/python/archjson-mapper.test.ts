/**
 * Tests for Python ArchJsonMapper
 *
 * P0.1 - entity ID collision: IDs must use dotted Python path, not bare filename
 * P0.3 - decorator double-counting: module-level function decorators must not be
 *         duplicated on the sole member
 */
import { describe, it, expect } from 'vitest';
import { ArchJsonMapper } from '@/plugins/python/archjson-mapper.js';
import type { PythonRawModule } from '@/plugins/python/types.js';

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
    const module = makeModule({
      filePath: `${BASE_WS}/myapp/utils.py`,
      imports: [{ module: 'os', names: [] }],
    });

    const result = mapper.mapModules([module], BASE_WS);
    const rel = result.relations[0];
    expect(rel).toBeDefined();
    expect(rel.source).not.toMatch(/^module:/);
    expect(rel.source).toBe('myapp.utils');
  });

  it('source ID falls back to bare moduleName (no module: prefix) without workspaceRoot', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      name: 'utils',
      filePath: `${BASE_WS}/myapp/utils.py`,
      imports: [{ module: 'os', names: [] }],
    });

    const result = mapper.mapModules([module]); // no workspaceRoot
    const rel = result.relations[0];
    expect(rel).toBeDefined();
    expect(rel.source).not.toMatch(/^module:/);
    expect(rel.source).toBe('utils');
  });

  it('__init__.py module source ID resolves to parent directory dotted path', () => {
    const mapper = new ArchJsonMapper();
    const module = makeModule({
      name: '__init__',
      filePath: `${BASE_WS}/myapp/engine/__init__.py`,
      imports: [{ module: 'abc', names: [] }],
    });

    const result = mapper.mapModules([module], BASE_WS);
    const rel = result.relations[0];
    expect(rel.source).toBe('myapp.engine');
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
