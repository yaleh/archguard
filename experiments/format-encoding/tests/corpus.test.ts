import { describe, it, expect } from 'vitest';
import { archJsonToC } from '../lib/corpus.js';
import type { ArchJson } from '../lib/corpus.js';

describe('archJsonToC', () => {
  it('valid ArchJSON → correct C structure with entities normalised and relations mapped', () => {
    const input: ArchJson = {
      entities: [
        {
          name: 'Renderer',
          type: 'class',
          sourceFile: 'src/renderer.ts',
          methods: [
            { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
          ],
        },
        {
          name: 'IRenderer',
          type: 'interface',
          sourceFile: 'src/types.ts',
          methods: [
            { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
          ],
        },
      ],
      relations: [{ from: 'Renderer', to: 'IRenderer', type: 'implementation' }],
    };

    const c = archJsonToC(input);

    expect(c.entities).toHaveLength(2);

    const renderer = c.entities.find(e => e.name === 'Renderer');
    expect(renderer).toBeDefined();
    expect(renderer!.id).toBe('renderer'); // normalizeId lowercases
    expect(renderer!.type).toBe('class');
    expect(renderer!.sourceFile).toBe('src/renderer.ts');
    expect(renderer!.methods).toHaveLength(1);
    expect(renderer!.methods[0]!.name).toBe('render');
    expect(renderer!.methods[0]!.params).toEqual([{ name: 'config', type: 'Config' }]);
    expect(renderer!.methods[0]!.returnType).toBe('string');

    expect(c.relations).toHaveLength(1);
    expect(c.relations[0]).toEqual({ from: 'renderer', to: 'irenderer', type: 'implementation' });
  });

  it('unknown entity type → type: "type" (fallback)', () => {
    const input: ArchJson = {
      entities: [{ name: 'MyThing', type: 'module', sourceFile: 'src/thing.ts' }],
    };
    const c = archJsonToC(input);
    expect(c.entities[0]!.type).toBe('type');
  });

  it('unknown relation type → filtered out (not included in C.relations)', () => {
    const input: ArchJson = {
      entities: [
        { name: 'A', type: 'class' },
        { name: 'B', type: 'class' },
      ],
      relations: [
        { from: 'A', to: 'B', type: 'unknown_rel_type' },
        { from: 'A', to: 'B', type: 'dependency' }, // valid
      ],
    };
    const c = archJsonToC(input);
    expect(c.relations).toHaveLength(1);
    expect(c.relations[0]!.type).toBe('dependency');
  });

  it('missing methods/params/returnType → defaults applied ([], [], "void")', () => {
    const input: ArchJson = {
      entities: [
        {
          name: 'Minimal',
          type: 'class',
          // no sourceFile, no methods
        },
        {
          name: 'WithMethodDefaults',
          type: 'class',
          methods: [
            { name: 'doSomething' }, // no params, no returnType
          ],
        },
      ],
    };
    const c = archJsonToC(input);

    const minimal = c.entities.find(e => e.name === 'Minimal');
    expect(minimal).toBeDefined();
    expect(minimal!.methods).toEqual([]);
    expect(minimal!.sourceFile).toBe('unknown');

    const withDefaults = c.entities.find(e => e.name === 'WithMethodDefaults');
    expect(withDefaults).toBeDefined();
    expect(withDefaults!.methods).toHaveLength(1);
    expect(withDefaults!.methods[0]!.params).toEqual([]);
    expect(withDefaults!.methods[0]!.returnType).toBe('void');
  });
});
