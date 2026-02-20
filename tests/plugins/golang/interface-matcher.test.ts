/**
 * Tests for InterfaceMatcher
 */

import { describe, it, expect } from 'vitest';
import { InterfaceMatcher } from '../../../src/plugins/golang/interface-matcher.js';
import type { GoRawStruct, GoRawInterface } from '../../../src/plugins/golang/types.js';

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
});
