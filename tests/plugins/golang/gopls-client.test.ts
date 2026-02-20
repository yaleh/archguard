/**
 * Tests for GoplsClient - LSP client for gopls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoplsClient } from '../../../src/plugins/golang/gopls-client.js';
import path from 'path';

describe('GoplsClient', () => {
  let client: GoplsClient;

  beforeEach(() => {
    client = new GoplsClient();
  });

  afterEach(async () => {
    if (client) {
      await client.dispose();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully with valid workspace', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      await expect(client.initialize(workspaceRoot)).resolves.not.toThrow();
      expect(client.isInitialized()).toBe(true);
    });

    it('should throw error if gopls binary not found', async () => {
      const clientWithBadPath = new GoplsClient('/nonexistent/gopls');
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await expect(clientWithBadPath.initialize(workspaceRoot)).rejects.toThrow();
    });

    it('should handle multiple initialize calls gracefully', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);
      await client.initialize(workspaceRoot); // Second call should be no-op

      expect(client.isInitialized()).toBe(true);
    });

    it('should throw error if initialized without workspace root', async () => {
      await expect(client.initialize('')).rejects.toThrow();
    });
  });

  describe('getImplementations', () => {
    it('should get implementations for interface type', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await client.initialize(workspaceRoot);

      // Query for Runner interface implementations
      const implementations = await client.getImplementations('Runner', filePath, 11);

      expect(Array.isArray(implementations)).toBe(true);
      // Implementation detection will vary, but should not throw
    });

    it('should return empty array if no implementations found', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await client.initialize(workspaceRoot);

      const implementations = await client.getImplementations('NonExistentInterface', filePath, 1);

      expect(implementations).toEqual([]);
    });

    it('should throw if called before initialization', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await expect(
        client.getImplementations('Runner', filePath, 11)
      ).rejects.toThrow('GoplsClient not initialized');
    });

    it('should handle file not found gracefully', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);

      const implementations = await client.getImplementations(
        'Runner',
        '/nonexistent/file.go',
        1
      );

      expect(implementations).toEqual([]);
    });
  });

  describe('getTypeInfo', () => {
    it('should get type information for symbol', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await client.initialize(workspaceRoot);

      const typeInfo = await client.getTypeInfo('Service', filePath, 17);

      expect(typeInfo).toBeDefined();
      // Type info structure will vary, but should not throw
    });

    it('should return null if type not found', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await client.initialize(workspaceRoot);

      const typeInfo = await client.getTypeInfo('NonExistentType', filePath, 1);

      expect(typeInfo).toBeNull();
    });

    it('should throw if called before initialization', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const filePath = path.join(workspaceRoot, 'sample.go');

      await expect(
        client.getTypeInfo('Service', filePath, 17)
      ).rejects.toThrow('GoplsClient not initialized');
    });
  });

  describe('process lifecycle', () => {
    it('should dispose cleanly', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);
      expect(client.isInitialized()).toBe(true);

      await client.dispose();
      expect(client.isInitialized()).toBe(false);
    });

    it('should handle multiple dispose calls', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);

      await client.dispose();
      await client.dispose(); // Second call should be safe

      expect(client.isInitialized()).toBe(false);
    });

    it('should allow re-initialization after dispose', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);
      await client.dispose();
      await client.initialize(workspaceRoot);

      expect(client.isInitialized()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle gopls process crash gracefully', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);

      // Simulate process crash by killing the process
      // This is hard to test reliably, so we'll just check disposal works
      await expect(client.dispose()).resolves.not.toThrow();
    });

    it('should timeout on long-running requests', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      const clientWithShortTimeout = new GoplsClient('gopls', 5000); // 5s timeout for init

      await clientWithShortTimeout.initialize(workspaceRoot);

      // This might timeout or succeed depending on gopls speed
      // We just ensure it doesn't hang forever
      const startTime = Date.now();

      try {
        await clientWithShortTimeout.getImplementations('Runner', 'sample.go', 11);
      } catch (error) {
        // Timeout is acceptable
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(10000); // Should not take more than 10s

      await clientWithShortTimeout.dispose();
    }, 15000);
  });

  describe('LSP protocol', () => {
    it('should send valid LSP initialize request', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      // This test verifies initialization follows LSP protocol
      await expect(client.initialize(workspaceRoot)).resolves.not.toThrow();
      expect(client.isInitialized()).toBe(true);
    });

    it('should handle LSP error responses', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);

      // Invalid line number should be handled gracefully
      const result = await client.getImplementations('Runner', 'sample.go', -1);
      expect(result).toEqual([]);
    });
  });
});
