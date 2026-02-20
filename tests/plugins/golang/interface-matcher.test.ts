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
});
