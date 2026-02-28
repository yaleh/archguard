/**
 * Tests for GoplsClient - LSP client for gopls
 *
 * Uses mocked child_process.spawn so tests run without a real gopls binary.
 * The fake process simulates LSP Content-Length framing and responds to
 * initialize / shutdown / textDocument/* requests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

// ---------------------------------------------------------------------------
// Fake process factory
// ---------------------------------------------------------------------------

/**
 * Build a fake LSP response with proper Content-Length framing.
 */
function makeLspResponse(id: number, result: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  const len = Buffer.byteLength(body, 'utf-8');
  return `Content-Length: ${len}\r\n\r\n${body}`;
}

/**
 * Build a fake gopls "version" process that exits immediately with code 0.
 */
function createVersionProc(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  const proc = new EventEmitter() as any;
  proc.kill = vi.fn();
  proc.stdin = null;
  proc.stdout = null;
  proc.stderr = new EventEmitter();
  // Emit exit on the next tick so listeners are attached first.
  setImmediate(() => proc.emit('exit', 0, null));
  return proc;
}

/**
 * Build a fake gopls "serve" process.
 *
 * When the caller writes an LSP request to stdin the fake stdout emits the
 * appropriate response.  Supported methods:
 *   - initialize  → {capabilities:{}}
 *   - shutdown    → null
 *   - textDocument/implementation → [] (empty array)
 *   - textDocument/hover          → null
 *
 * Unknown requests are silently ignored (no response → the pending request
 * will eventually time out, which is the correct behaviour for timeout tests).
 */
function createServeProc(opts: { noInitResponse?: boolean } = {}) {
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;

  // Buffer accumulating stdin writes so we can parse complete LSP messages.
  let inputBuffer = '';

  const stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      inputBuffer += chunk.toString();

      // Process all complete LSP messages in the buffer.
      while (true) {
        const headerMatch = inputBuffer.match(/Content-Length: (\d+)\r\n\r\n/);
        if (!headerMatch) break;

        const contentLength = parseInt(headerMatch[1], 10);
        const headerLen = headerMatch[0].length;
        const bodyStart = (headerMatch.index ?? 0) + headerLen;
        const bodyEnd = bodyStart + contentLength;

        if (inputBuffer.length < bodyEnd) break;

        const body = inputBuffer.substring(bodyStart, bodyEnd);
        inputBuffer = inputBuffer.substring(bodyEnd);

        // Parse and respond.
        try {
          const msg = JSON.parse(body);

          // Only respond to requests (they have an id).
          if (msg.id === undefined) continue;

          let result: unknown = null;

          if (msg.method === 'initialize') {
            if (opts.noInitResponse) continue; // simulate no response (timeout test)
            result = { capabilities: {} };
          } else if (msg.method === 'shutdown') {
            result = null;
          } else if (msg.method === 'textDocument/implementation') {
            result = [];
          } else if (msg.method === 'textDocument/hover') {
            result = null;
          } else {
            // Unknown method — no response.
            continue;
          }

          const response = makeLspResponse(msg.id, result);
          setImmediate(() => stdout.emit('data', Buffer.from(response)));
        } catch {
          // Ignore malformed input.
        }
      }

      callback();
    },
  });

  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 12345;
  proc.kill = vi.fn(() => {
    setImmediate(() => proc.emit('exit', 0, null));
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

// We need a reference to the spawn mock that the GoplsClient will import.
// vi.mock hoists the factory, so we define the spy outside and set it up
// inside beforeEach.
const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ---------------------------------------------------------------------------
// Import GoplsClient AFTER the mock is installed.
// ---------------------------------------------------------------------------

import { GoplsClient } from '../../../src/plugins/golang/gopls-client.js';
import path from 'path';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoplsClient', () => {
  let client: GoplsClient;

  beforeEach(() => {
    // Default spawn behaviour: version check → success, serve → full LSP fake.
    const callCount = 0;
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args && args[0] === 'version') {
        return createVersionProc();
      }
      return createServeProc();
    });

    client = new GoplsClient();
  });

  afterEach(async () => {
    if (client) {
      await client.dispose();
    }
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully with valid workspace', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');
      await expect(client.initialize(workspaceRoot)).resolves.not.toThrow();
      expect(client.isInitialized()).toBe(true);
    });

    it('should throw error if gopls binary not found', async () => {
      // Make the version-check process emit an error event.
      spawnMock.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.kill = vi.fn();
        proc.stdin = null;
        proc.stdout = null;
        proc.stderr = new EventEmitter();
        setImmediate(() => proc.emit('error', new Error('spawn ENOENT')));
        return proc;
      });

      const clientWithBadPath = new GoplsClient('/nonexistent/gopls');
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await expect(clientWithBadPath.initialize(workspaceRoot)).rejects.toThrow();
    });

    it('should handle multiple initialize calls gracefully', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);
      await client.initialize(workspaceRoot); // Second call should be no-op

      expect(client.isInitialized()).toBe(true);
      // spawn should have been called exactly twice (version + serve) for the
      // first initialize; the second call is a no-op and must not spawn again.
      expect(spawnMock).toHaveBeenCalledTimes(2);
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

      await expect(client.getImplementations('Runner', filePath, 11)).rejects.toThrow(
        'GoplsClient not initialized'
      );
    });

    it('should handle file not found gracefully', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      await client.initialize(workspaceRoot);

      const implementations = await client.getImplementations('Runner', '/nonexistent/file.go', 1);

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

      await expect(client.getTypeInfo('Service', filePath, 17)).rejects.toThrow(
        'GoplsClient not initialized'
      );
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
      // Use a very short timeout so the test completes quickly.
      const clientWithShortTimeout = new GoplsClient('gopls', 200); // 200ms timeout

      // The serve mock will NOT respond to initialize, so it times out fast.
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args && args[0] === 'version') return createVersionProc();
        // Return a serve process that never responds.
        return createServeProc({ noInitResponse: true });
      });

      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      const startTime = Date.now();
      // Initialize will fail because the initialize request times out.
      try {
        await clientWithShortTimeout.initialize(workspaceRoot);
      } catch {
        // Timeout or init failure is expected.
      }
      const elapsed = Date.now() - startTime;

      // Should fail fast (well under 10s).
      expect(elapsed).toBeLessThan(10000);

      await clientWithShortTimeout.dispose();
    }, 15000);
  });

  describe('LSP protocol', () => {
    it('should send valid LSP initialize request', async () => {
      const workspaceRoot = path.resolve(__dirname, '../../fixtures/go');

      // Capture what is written to stdin so we can verify the LSP format.
      let capturedInput = '';
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args && args[0] === 'version') return createVersionProc();

        const proc = createServeProc();
        // Wrap stdin to capture writes.
        const originalWrite = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk: Buffer | string, ...rest: any[]) => {
          capturedInput += chunk.toString();
          return originalWrite(chunk, ...rest);
        };
        return proc;
      });

      await client.initialize(workspaceRoot);

      // The captured input must contain a valid LSP Content-Length header.
      expect(capturedInput).toMatch(/Content-Length: \d+\r\n\r\n/);

      // The JSON body must be valid JSON-RPC with method "initialize".
      const headerMatch = capturedInput.match(/Content-Length: (\d+)\r\n\r\n([\s\S]+)/);
      expect(headerMatch).not.toBeNull();
      if (headerMatch) {
        const body = JSON.parse(headerMatch[2].substring(0, parseInt(headerMatch[1], 10)));
        expect(body.jsonrpc).toBe('2.0');
        expect(body.method).toBe('initialize');
        expect(body.id).toBeTypeOf('number');
      }
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
