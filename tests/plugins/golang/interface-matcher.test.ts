/**
 * Tests for InterfaceMatcher
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InterfaceMatcher } from '../../../src/plugins/golang/interface-matcher.js';
import { GoplsClient } from '../../../src/plugins/golang/gopls-client.js';
import type { GoRawStruct, GoRawInterface } from '../../../src/plugins/golang/types.js';
import path from 'path';

describe('InterfaceMatcher', () => {
  const matcher = new InterfaceMatcher();

  it('should match struct implementing interface', () => {
    const struct: GoRawStruct = {
      name: 'Service',
      packageName: 'main',
      fields: [],
      methods: [
        {
          name: 'Start',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 1, endLine: 1 },
        },
        {
          name: 'Stop',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 2, endLine: 2 },
        },
      ],
      embeddedTypes: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const iface: GoRawInterface = {
      name: 'Runner',
      packageName: 'main',
      methods: [
        {
          name: 'Start',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 1, endLine: 1 },
        },
        {
          name: 'Stop',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 2, endLine: 2 },
        },
      ],
      embeddedInterfaces: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const results = matcher.matchImplicitImplementations([struct], [iface]);

    expect(results).toHaveLength(1);
    expect(results[0].structName).toBe('Service');
    expect(results[0].interfaceName).toBe('Runner');
    expect(results[0].matchedMethods).toEqual(['Start', 'Stop']);
    expect(results[0].confidence).toBe(1.0);
  });

  it('should not match struct missing interface methods', () => {
    const struct: GoRawStruct = {
      name: 'PartialService',
      packageName: 'main',
      fields: [],
      methods: [
        {
          name: 'Start',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 1, endLine: 1 },
        },
      ],
      embeddedTypes: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const iface: GoRawInterface = {
      name: 'Runner',
      packageName: 'main',
      methods: [
        {
          name: 'Start',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 1, endLine: 1 },
        },
        {
          name: 'Stop',
          parameters: [],
          returnTypes: [],
          exported: true,
          location: { file: 'test.go', startLine: 2, endLine: 2 },
        },
      ],
      embeddedInterfaces: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const results = matcher.matchImplicitImplementations([struct], [iface]);

    expect(results).toHaveLength(0);
  });

  it('should handle empty interfaces', () => {
    const struct: GoRawStruct = {
      name: 'AnyStruct',
      packageName: 'main',
      fields: [],
      methods: [],
      embeddedTypes: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const iface: GoRawInterface = {
      name: 'EmptyInterface',
      packageName: 'main',
      methods: [],
      embeddedInterfaces: [],
      exported: true,
      location: { file: 'test.go', startLine: 1, endLine: 5 },
    };

    const results = matcher.matchImplicitImplementations([struct], [iface]);

    // Empty interfaces match nothing in our simplified implementation
    expect(results).toHaveLength(0);
  });

  describe('gopls-based matching', () => {
    let goplsClient: GoplsClient;
    const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
    const sampleFile = path.join(workspaceRoot, 'sample.go');

    beforeEach(async () => {
      goplsClient = new GoplsClient();
      await goplsClient.initialize(workspaceRoot);
    });

    afterEach(async () => {
      if (goplsClient) {
        await goplsClient.dispose();
      }
    });

    it('should match implementations using gopls or fallback gracefully', async () => {
      const struct: GoRawStruct = {
        name: 'Service',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 23, endLine: 25 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 28, endLine: 30 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: sampleFile, startLine: 17, endLine: 20 },
      };

      const iface: GoRawInterface = {
        name: 'Runner',
        packageName: 'main',
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 12, endLine: 12 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 13, endLine: 13 },
          },
        ],
        embeddedInterfaces: [],
        exported: true,
        location: { file: sampleFile, startLine: 11, endLine: 14 },
      };

      const results = await matcher.matchWithGopls([struct], [iface], goplsClient);

      // Should find the implementation via gopls or fallback
      expect(results.length).toBeGreaterThan(0);
      const serviceImpl = results.find(r => r.structName === 'Service');
      expect(serviceImpl).toBeDefined();
      expect(serviceImpl?.interfaceName).toBe('Runner');
      // Source can be either 'gopls' or 'inferred' (fallback)
      expect(['gopls', 'inferred']).toContain(serviceImpl?.source);
      // Confidence should be high regardless of source
      expect(serviceImpl?.confidence).toBeGreaterThan(0.9);
    });

    it('should return empty array if gopls finds no implementations', async () => {
      const struct: GoRawStruct = {
        name: 'NonImplementer',
        packageName: 'main',
        fields: [],
        methods: [],
        embeddedTypes: [],
        exported: true,
        location: { file: sampleFile, startLine: 1, endLine: 5 },
      };

      const iface: GoRawInterface = {
        name: 'Runner',
        packageName: 'main',
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 12, endLine: 12 },
          },
        ],
        embeddedInterfaces: [],
        exported: true,
        location: { file: sampleFile, startLine: 11, endLine: 14 },
      };

      const results = await matcher.matchWithGopls([struct], [iface], goplsClient);

      const nonImpl = results.find(r => r.structName === 'NonImplementer');
      expect(nonImpl).toBeUndefined();
    });

    it('should handle gopls errors gracefully and fall back to name-based matching', async () => {
      // Create a gopls client that will fail
      const badClient = new GoplsClient('/nonexistent/gopls');

      const struct: GoRawStruct = {
        name: 'Service',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 23, endLine: 25 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 28, endLine: 30 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: sampleFile, startLine: 17, endLine: 20 },
      };

      const iface: GoRawInterface = {
        name: 'Runner',
        packageName: 'main',
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 12, endLine: 12 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: sampleFile, startLine: 13, endLine: 13 },
          },
        ],
        embeddedInterfaces: [],
        exported: true,
        location: { file: sampleFile, startLine: 11, endLine: 14 },
      };

      // Should fall back to name-based matching
      const results = await matcher.matchWithGopls([struct], [iface], badClient);

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('inferred');
      expect(results[0].confidence).toBe(1.0);
    });
  });

  describe('hybrid matching (gopls + fallback)', () => {
    it('should combine gopls results with fallback when gopls available', async () => {
      const goplsClient = new GoplsClient();
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await goplsClient.initialize(workspaceRoot);

      const struct: GoRawStruct = {
        name: 'Service',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 2, endLine: 2 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const iface: GoRawInterface = {
        name: 'Runner',
        packageName: 'main',
        methods: [
          {
            name: 'Start',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
          {
            name: 'Stop',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 2, endLine: 2 },
          },
        ],
        embeddedInterfaces: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const results = await matcher.matchWithGopls([struct], [iface], goplsClient);

      expect(results.length).toBeGreaterThanOrEqual(1);
      const impl = results.find(r => r.structName === 'Service' && r.interfaceName === 'Runner');
      expect(impl).toBeDefined();

      await goplsClient.dispose();
    });
  });

  describe('embedded method promotion', () => {
    it('should promote methods from value-embedded struct', () => {
      // type Base struct { ... }
      // func (b Base) Method1() {}
      // func (b *Base) Method2() {}
      //
      // type Derived struct {
      //   Base  // value embedding
      // }
      // Derived should have Method1 (value receiver) in both value and pointer method sets
      // Derived should have Method2 (pointer receiver) only in pointer method set

      const base: GoRawStruct = {
        name: 'Base',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method1',
            parameters: [],
            returnTypes: [],
            receiver: 'b',
            receiverType: 'Base', // value receiver
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
          {
            name: 'Method2',
            parameters: [],
            returnTypes: [],
            receiver: 'b',
            receiverType: '*Base', // pointer receiver
            exported: true,
            location: { file: 'test.go', startLine: 2, endLine: 2 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const derived: GoRawStruct = {
        name: 'Derived',
        packageName: 'main',
        fields: [],
        methods: [],
        embeddedTypes: ['Base'],
        embeddedTypeRefs: [
          { name: 'Base', isPointer: false, location: { file: 'test.go', startLine: 1, endLine: 1 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 10, endLine: 15 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('Base', base);
      structMap.set('Derived', derived);

      const methodSet = matcher.buildMethodSet(derived, structMap);

      // Value receiver methods (Method1) should be in both sets
      expect(methodSet.valueMethodSet.has('Method1')).toBe(true);
      expect(methodSet.pointerMethodSet.has('Method1')).toBe(true);

      // Pointer receiver methods (Method2) should only be in pointer method set
      expect(methodSet.valueMethodSet.has('Method2')).toBe(false);
      expect(methodSet.pointerMethodSet.has('Method2')).toBe(true);
    });

    it('should promote methods from pointer-embedded struct', () => {
      // type Base struct { ... }
      // func (b Base) Method1() {}
      // func (b *Base) Method2() {}
      //
      // type Derived struct {
      //   *Base  // pointer embedding
      // }
      // Derived should only have promoted methods in pointer method set

      const base: GoRawStruct = {
        name: 'Base',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method1',
            parameters: [],
            returnTypes: [],
            receiver: 'b',
            receiverType: 'Base', // value receiver
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
          {
            name: 'Method2',
            parameters: [],
            returnTypes: [],
            receiver: 'b',
            receiverType: '*Base', // pointer receiver
            exported: true,
            location: { file: 'test.go', startLine: 2, endLine: 2 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const derived: GoRawStruct = {
        name: 'Derived',
        packageName: 'main',
        fields: [],
        methods: [],
        embeddedTypes: ['*Base'],
        embeddedTypeRefs: [
          { name: 'Base', isPointer: true, location: { file: 'test.go', startLine: 1, endLine: 1 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 10, endLine: 15 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('Base', base);
      structMap.set('Derived', derived);

      const methodSet = matcher.buildMethodSet(derived, structMap);

      // For pointer embedding, all promoted methods only go to pointer method set
      expect(methodSet.valueMethodSet.has('Method1')).toBe(false);
      expect(methodSet.pointerMethodSet.has('Method1')).toBe(true);
      expect(methodSet.valueMethodSet.has('Method2')).toBe(false);
      expect(methodSet.pointerMethodSet.has('Method2')).toBe(true);
    });

    it('should detect circular embedding', () => {
      // type A struct { B }
      // type B struct { A } // circular!

      const structA: GoRawStruct = {
        name: 'A',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'MethodA',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedTypes: ['B'],
        embeddedTypeRefs: [
          { name: 'B', isPointer: false, location: { file: 'test.go', startLine: 1, endLine: 1 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const structB: GoRawStruct = {
        name: 'B',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'MethodB',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 6, endLine: 6 },
          },
        ],
        embeddedTypes: ['A'],
        embeddedTypeRefs: [
          { name: 'A', isPointer: false, location: { file: 'test.go', startLine: 6, endLine: 6 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 6, endLine: 10 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('A', structA);
      structMap.set('B', structB);

      // Should not hang or crash
      const methodSetA = matcher.buildMethodSet(structA, structMap);
      const methodSetB = matcher.buildMethodSet(structB, structMap);

      // Each should have its own methods
      expect(methodSetA.valueMethodSet.has('MethodA')).toBe(true);
      expect(methodSetB.valueMethodSet.has('MethodB')).toBe(true);

      // Should not have promoted methods due to cycle
      expect(methodSetA.valueMethodSet.has('MethodB')).toBe(false);
      expect(methodSetB.valueMethodSet.has('MethodA')).toBe(false);
    });

    it('should handle method name conflicts (outer method wins)', () => {
      // type Base struct {}
      // func (b Base) Method() {} // Method1
      //
      // type Derived struct {
      //   Base
      // }
      // func (d Derived) Method() {} // Method2 - shadows Base.Method

      const base: GoRawStruct = {
        name: 'Base',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method',
            parameters: [],
            returnTypes: ['string'],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const derived: GoRawStruct = {
        name: 'Derived',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method',
            parameters: [],
            returnTypes: ['int'], // Different signature, same name
            exported: true,
            location: { file: 'test.go', startLine: 10, endLine: 10 },
          },
        ],
        embeddedTypes: ['Base'],
        embeddedTypeRefs: [
          { name: 'Base', isPointer: false, location: { file: 'test.go', startLine: 8, endLine: 8 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 8, endLine: 15 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('Base', base);
      structMap.set('Derived', derived);

      const methodSet = matcher.buildMethodSet(derived, structMap);

      // Should have Method from Derived (not Base)
      expect(methodSet.valueMethodSet.has('Method')).toBe(true);
      const method = methodSet.valueMethodSet.get('Method');
      expect(method?.normalizedSignature).toContain('int'); // Derived's version
    });

    it('should not promote ambiguous methods from same-level embeddings', () => {
      // type A struct { Method() }
      // type B struct { Method() }
      // type C struct { A; B } // Method is ambiguous, not promoted

      const structA: GoRawStruct = {
        name: 'A',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const structB: GoRawStruct = {
        name: 'B',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Method',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 6, endLine: 6 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 6, endLine: 10 },
      };

      const structC: GoRawStruct = {
        name: 'C',
        packageName: 'main',
        fields: [],
        methods: [],
        embeddedTypes: ['A', 'B'],
        embeddedTypeRefs: [
          { name: 'A', isPointer: false, location: { file: 'test.go', startLine: 11, endLine: 11 } },
          { name: 'B', isPointer: false, location: { file: 'test.go', startLine: 12, endLine: 12 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 11, endLine: 15 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('A', structA);
      structMap.set('B', structB);
      structMap.set('C', structC);

      const methodSet = matcher.buildMethodSet(structC, structMap);

      // Method should not be promoted due to ambiguity
      expect(methodSet.valueMethodSet.has('Method')).toBe(false);
      expect(methodSet.pointerMethodSet.has('Method')).toBe(false);
    });

    it('should handle multi-level embedding', () => {
      // type GrandParent struct { GrandMethod() }
      // type Parent struct { GrandParent; ParentMethod() }
      // type Child struct { Parent; ChildMethod() }
      // Child should have GrandMethod, ParentMethod, ChildMethod

      const grandParent: GoRawStruct = {
        name: 'GrandParent',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'GrandMethod',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const parent: GoRawStruct = {
        name: 'Parent',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'ParentMethod',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 8, endLine: 8 },
          },
        ],
        embeddedTypes: ['GrandParent'],
        embeddedTypeRefs: [
          { name: 'GrandParent', isPointer: false, location: { file: 'test.go', startLine: 7, endLine: 7 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 7, endLine: 12 },
      };

      const child: GoRawStruct = {
        name: 'Child',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'ChildMethod',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 16, endLine: 16 },
          },
        ],
        embeddedTypes: ['Parent'],
        embeddedTypeRefs: [
          { name: 'Parent', isPointer: false, location: { file: 'test.go', startLine: 15, endLine: 15 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 15, endLine: 20 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('GrandParent', grandParent);
      structMap.set('Parent', parent);
      structMap.set('Child', child);

      const methodSet = matcher.buildMethodSet(child, structMap);

      // Should have all methods from hierarchy
      expect(methodSet.valueMethodSet.has('GrandMethod')).toBe(true);
      expect(methodSet.valueMethodSet.has('ParentMethod')).toBe(true);
      expect(methodSet.valueMethodSet.has('ChildMethod')).toBe(true);
    });

    it('should match interface using promoted methods', () => {
      // type Runner interface { Run() }
      // type Base struct {}
      // func (b Base) Run() {}
      // type Derived struct { Base } // inherits Run via promotion

      const base: GoRawStruct = {
        name: 'Base',
        packageName: 'main',
        fields: [],
        methods: [
          {
            name: 'Run',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedTypes: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 5 },
      };

      const derived: GoRawStruct = {
        name: 'Derived',
        packageName: 'main',
        fields: [],
        methods: [], // No direct methods
        embeddedTypes: ['Base'],
        embeddedTypeRefs: [
          { name: 'Base', isPointer: false, location: { file: 'test.go', startLine: 6, endLine: 6 } },
        ],
        exported: true,
        location: { file: 'test.go', startLine: 6, endLine: 10 },
      };

      const iface: GoRawInterface = {
        name: 'Runner',
        packageName: 'main',
        methods: [
          {
            name: 'Run',
            parameters: [],
            returnTypes: [],
            exported: true,
            location: { file: 'test.go', startLine: 1, endLine: 1 },
          },
        ],
        embeddedInterfaces: [],
        exported: true,
        location: { file: 'test.go', startLine: 1, endLine: 3 },
      };

      const structMap = new Map<string, GoRawStruct>();
      structMap.set('Base', base);
      structMap.set('Derived', derived);

      // Test that Derived can match Runner via promoted method
      const results = matcher.matchImplicitImplementationsWithEmbedding(
        [derived],
        [iface],
        structMap
      );

      expect(results).toHaveLength(1);
      expect(results[0].structName).toBe('Derived');
      expect(results[0].interfaceName).toBe('Runner');
      expect(results[0].matchedMethods).toContain('Run');
    });
  });
});
