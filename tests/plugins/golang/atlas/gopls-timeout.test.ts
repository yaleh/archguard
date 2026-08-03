/**
 * TASK-44 — Atlas gopls timeout / degradation / poison-pill behaviour.
 *
 * Atlas mode builds the gopls-assisted layers through GoplsInterfaceResolver.
 * These tests inject a fake gopls (mocked child_process.spawn, controllable
 * latency — no real binary) and assert the Atlas-level reliability contract:
 *
 *   1. A hanging gopls degrades the resolver instead of stalling.
 *   2. The degraded resolver still yields tree-sitter (name-based) results.
 *   3. After one timeout the process-wide poison-pill prevents ANY further
 *      gopls spawn within the same process (no retry).
 *   4. The hung child is reaped and the poisoned state is diagnosable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

function makeLspResponse(id: number, result: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  const len = Buffer.byteLength(body, 'utf-8');
  return `Content-Length: ${len}\r\n\r\n${body}`;
}

function makeVersionProc() {
  const proc = new EventEmitter() as any;
  proc.kill = vi.fn();
  proc.stdin = null;
  proc.stdout = null;
  proc.stderr = new EventEmitter();
  proc.pid = 77777;
  setImmediate(() => proc.emit('exit', 0, null));
  return proc;
}

function makeServeProc(opts: { hang?: boolean } = {}) {
  const stdout = new EventEmitter() as any;
  let inputBuffer = '';
  const stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      inputBuffer += chunk.toString();
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
        try {
          const msg = JSON.parse(body);
          if (msg.id === undefined) continue;
          if (opts.hang) continue;
          let result: unknown = null;
          if (msg.method === 'initialize') result = { capabilities: {} };
          else if (msg.method === 'shutdown') result = null;
          else if (msg.method === 'textDocument/implementation') result = [];
          else continue;
          const response = makeLspResponse(msg.id, result);
          setImmediate(() => stdout.emit('data', Buffer.from(response)));
        } catch {
          // ignore
        }
      }
      callback();
    },
  });
  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.pid = 88888;
  proc.kill = vi.fn(() => setImmediate(() => proc.emit('exit', 0, null)));
  return proc;
}

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { GoplsInterfaceResolver } from '../../../../src/plugins/golang/gopls-interface-resolver.js';
import {
  resetGoplsPoison,
  isGoplsPoisoned,
  getGoplsDiagnostics,
} from '../../../../src/plugins/golang/gopls-client.js';
import type { GoRawStruct, GoRawInterface } from '../../../../src/plugins/golang/types.js';

const WS = '/tmp/atlas-gopls-ws';

const struct: GoRawStruct & { packageName: string } = {
  name: 'Service',
  packageName: 'main',
  fields: [],
  methods: [
    {
      name: 'Start',
      parameters: [],
      returnTypes: [],
      exported: true,
      location: { file: 'a.go', startLine: 1, endLine: 1 },
    },
  ],
  embeddedTypes: [],
  exported: true,
  location: { file: 'a.go', startLine: 1, endLine: 5 },
};

const iface: GoRawInterface & { packageName: string } = {
  name: 'Runner',
  packageName: 'main',
  methods: [
    {
      name: 'Start',
      parameters: [],
      returnTypes: [],
      exported: true,
      location: { file: 'a.go', startLine: 1, endLine: 1 },
    },
  ],
  embeddedInterfaces: [],
  exported: true,
  location: { file: 'a.go', startLine: 1, endLine: 5 },
};

describe('Atlas gopls timeout → degradation + poison-pill', () => {
  let spawned: Array<{ args: string[]; proc: any }>;

  beforeEach(() => {
    resetGoplsPoison();
    spawned = [];
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const proc =
        args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true });
      spawned.push({ args, proc });
      return proc;
    });
  });

  afterEach(() => {
    resetGoplsPoison();
    vi.clearAllMocks();
  });

  it('degrades on timeout, reaps the child, and never re-spawns gopls in this process', async () => {
    // --- First resolver: hanging gopls blows the 120ms budget ---
    const first = new GoplsInterfaceResolver({ budgetMs: 120, warn: () => {} });
    const start = Date.now();
    await first.initialize(WS);
    expect(Date.now() - start).toBeLessThan(5000); // bounded

    expect(first.isDegraded()).toBe(true);
    expect(first.isGoplsAvailable()).toBe(false);
    expect(isGoplsPoisoned()).toBe(true);

    // Hung serve child reaped.
    const serveEntry = spawned.find((s) => s.args[0] !== 'version');
    expect(serveEntry.proc.kill).toHaveBeenCalled();

    // Degraded resolver still produces tree-sitter results.
    const results = await first.resolve([struct], [iface]);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('inferred');
    await first.dispose();

    // --- Second resolver in the SAME process: poison-pill → no spawn ---
    const callsBefore = spawnMock.mock.calls.length;
    const second = new GoplsInterfaceResolver({ budgetMs: 120, warn: () => {} });
    await second.initialize(WS);

    expect(spawnMock.mock.calls.length).toBe(callsBefore); // never retried
    expect(second.isDegraded()).toBe(true);
    expect(second.isGoplsAvailable()).toBe(false);
    expect(second.getDegradedReason()).toMatch(/poison-pill/);

    // Poisoned state is surfaced in diagnostics.
    expect(getGoplsDiagnostics().join('\n')).toMatch(/POISON-PILL active/);
    await second.dispose();
  });
});
