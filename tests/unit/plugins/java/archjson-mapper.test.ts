import { describe, it, expect, beforeEach } from 'vitest';
import { ArchJsonMapper } from '@/plugins/java/archjson-mapper.js';
import type { Entity, Relation } from '@/types/index.js';

describe('ArchJsonMapper — reconcileInheritanceTargets — cross-package inheritance', () => {
  let mapper: ArchJsonMapper;

  beforeEach(() => {
    mapper = new ArchJsonMapper();
  });

  it('corrects inheritance target when parent is in a different package', () => {
    const entities: Entity[] = [
      { id: 'com.example.llama.LlamaModel', name: 'LlamaModel', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.gemma.GemmaModel', name: 'GemmaModel', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.gemma.GemmaModel_inheritance_com.example.gemma.LlamaModel',
        type: 'inheritance',
        source: 'com.example.gemma.GemmaModel',
        target: 'com.example.gemma.LlamaModel', // wrong — gemma package has no LlamaModel
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.example.llama.LlamaModel');
    expect(result[0].source).toBe('com.example.gemma.GemmaModel');
  });

  it('leaves same-package inheritance unchanged when target is already correct', () => {
    const entities: Entity[] = [
      { id: 'com.example.pkg.Parent', name: 'Parent', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.pkg.Child', name: 'Child', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.pkg.Child_inheritance_com.example.pkg.Parent',
        type: 'inheritance',
        source: 'com.example.pkg.Child',
        target: 'com.example.pkg.Parent', // correct — exists in entity set
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.example.pkg.Parent'); // unchanged
  });

  it('leaves external (JDK/library) inheritance targets unchanged', () => {
    const entities: Entity[] = [
      { id: 'com.example.MyList', name: 'MyList', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.MyList_inheritance_com.example.AbstractList',
        type: 'inheritance',
        source: 'com.example.MyList',
        target: 'com.example.AbstractList', // not in entity set (external)
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.example.AbstractList'); // unchanged
  });

  it('does not alter dependency relations (only inheritance/implementation)', () => {
    const entities: Entity[] = [
      { id: 'com.example.b.Service', name: 'Service', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.a.Client_dependency_com.example.a.Service',
        type: 'dependency',
        source: 'com.example.a.Client',
        target: 'com.example.a.Service', // wrong package, but it's a dependency — not fixed
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    // dependency type is not touched by this method
    expect(result[0].target).toBe('com.example.a.Service');
  });

  it('reconciles implementation relations across packages', () => {
    const entities: Entity[] = [
      { id: 'com.example.api.Repository', name: 'Repository', type: 'interface', visibility: 'public', members: [] },
      { id: 'com.example.impl.UserService', name: 'UserService', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.impl.UserService_implementation_com.example.impl.Repository',
        type: 'implementation',
        source: 'com.example.impl.UserService',
        target: 'com.example.impl.Repository', // wrong — should be api.Repository
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.example.api.Repository');
  });

  it('updates the relation id when correcting the target', () => {
    const entities: Entity[] = [
      { id: 'com.example.llama.LlamaModel', name: 'LlamaModel', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.gemma.GemmaModel', name: 'GemmaModel', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.gemma.GemmaModel_inheritance_com.example.gemma.LlamaModel',
        type: 'inheritance',
        source: 'com.example.gemma.GemmaModel',
        target: 'com.example.gemma.LlamaModel',
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].id).toBe(
      'com.example.gemma.GemmaModel_inheritance_com.example.llama.LlamaModel'
    );
  });

  it('does not mutate the original relations array', () => {
    const entities: Entity[] = [
      { id: 'com.example.llama.LlamaModel', name: 'LlamaModel', type: 'class', visibility: 'public', members: [] },
    ];
    const original: Relation[] = [
      {
        id: 'com.example.gemma.GemmaModel_inheritance_com.example.gemma.LlamaModel',
        type: 'inheritance',
        source: 'com.example.gemma.GemmaModel',
        target: 'com.example.gemma.LlamaModel',
      },
    ];
    const originalTarget = original[0].target;

    mapper.reconcileInheritanceTargets(entities, original);

    // Original must be unchanged
    expect(original[0].target).toBe(originalTarget);
  });

  it('handles multi-level inheritance chain across three packages', () => {
    // A extends B, B extends C — all in different packages
    const entities: Entity[] = [
      { id: 'com.example.a.ClassA', name: 'ClassA', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.b.ClassB', name: 'ClassB', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.c.ClassC', name: 'ClassC', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.a.ClassA_inheritance_com.example.a.ClassB', // wrong package
        type: 'inheritance',
        source: 'com.example.a.ClassA',
        target: 'com.example.a.ClassB',
      },
      {
        id: 'com.example.b.ClassB_inheritance_com.example.b.ClassC', // wrong package
        type: 'inheritance',
        source: 'com.example.b.ClassB',
        target: 'com.example.b.ClassC',
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.example.b.ClassB');
    expect(result[1].target).toBe('com.example.c.ClassC');
  });

  it('first-entity-wins collision policy when two entities share a simple name', () => {
    // Two entities with the same simple name in different packages
    const entities: Entity[] = [
      { id: 'com.example.a.Util', name: 'Util', type: 'class', visibility: 'public', members: [] },
      { id: 'com.example.b.Util', name: 'Util', type: 'class', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.example.c.MyClass_inheritance_com.example.c.Util',
        type: 'inheritance',
        source: 'com.example.c.MyClass',
        target: 'com.example.c.Util', // not in entity set
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    // First entity wins
    expect(result[0].target).toBe('com.example.a.Util');
  });

  it('returns an empty array when given empty arrays', () => {
    const result = mapper.reconcileInheritanceTargets([], []);
    expect(result).toEqual([]);
  });

  it('passes through all relation types correctly in a mixed array', () => {
    const entities: Entity[] = [
      { id: 'com.b.Base', name: 'Base', type: 'class', visibility: 'public', members: [] },
      { id: 'com.i.Iface', name: 'Iface', type: 'interface', visibility: 'public', members: [] },
    ];
    const relations: Relation[] = [
      {
        id: 'com.a.Child_inheritance_com.a.Base',
        type: 'inheritance',
        source: 'com.a.Child',
        target: 'com.a.Base', // wrong package — should be com.b.Base
      },
      {
        id: 'com.a.Child_implementation_com.a.Iface',
        type: 'implementation',
        source: 'com.a.Child',
        target: 'com.a.Iface', // wrong package — should be com.i.Iface
      },
      {
        id: 'com.a.Child_dependency_com.a.Dep',
        type: 'dependency',
        source: 'com.a.Child',
        target: 'com.a.Dep', // dependency — not touched
      },
    ];

    const result = mapper.reconcileInheritanceTargets(entities, relations);

    expect(result[0].target).toBe('com.b.Base');
    expect(result[1].target).toBe('com.i.Iface');
    expect(result[2].target).toBe('com.a.Dep'); // unchanged
  });
});
